import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  httpRequest: vi.fn<(...args: unknown[]) => unknown>(),
  httpsRequest: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.httpRequest }));
vi.mock("node:https", () => ({ request: mocks.httpsRequest }));

import { fetchPublicUrlText } from "./safe-url";

interface ResponsePlan {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  hang?: boolean;
}

let plans: ResponsePlan[];

function makeFakeRequest(callback: (response: unknown) => void, plan: ResponsePlan) {
  const request = new EventEmitter() as EventEmitter & {
    end: () => void;
    destroy: (error?: Error) => void;
  };

  request.end = () => {
    if (plan.hang) return;

    queueMicrotask(() => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        destroyed: boolean;
        destroy: () => void;
      };
      response.statusCode = plan.statusCode;
      response.headers = plan.headers ?? {};
      response.destroyed = false;
      response.destroy = () => {
        response.destroyed = true;
      };

      callback(response);

      if (plan.statusCode < 200 || plan.statusCode >= 300 || response.destroyed) return;
      queueMicrotask(() => {
        const body = plan.body ?? "";
        const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
        if (bytes.length > 0 && !response.destroyed) response.emit("data", bytes);
        if (!response.destroyed) response.emit("end");
      });
    });
  };

  request.destroy = (error?: Error) => {
    if (error) queueMicrotask(() => request.emit("error", error));
  };

  return request;
}

function installRequestMocks() {
  const handler = (...args: unknown[]) => {
    const callback = args[1] as (response: unknown) => void;
    const plan = plans.shift() ?? { statusCode: 200, body: "ok" };
    return makeFakeRequest(callback, plan);
  };
  mocks.httpRequest.mockImplementation(handler);
  mocks.httpsRequest.mockImplementation(handler);
}

describe("fetchPublicUrlText", () => {
  beforeEach(() => {
    vi.useRealTimers();
    plans = [];
    mocks.lookup.mockReset();
    mocks.httpRequest.mockReset();
    mocks.httpsRequest.mockReset();
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    installRequestMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("revalidates every redirect and refuses a private redirect destination", async () => {
    plans.push({
      statusCode: 302,
      headers: { location: "http://127.0.0.1/admin" },
    });

    await expect(fetchPublicUrlText("http://start.example.com")).rejects.toThrow(
      "Private or reserved IP destinations are not allowed",
    );
    expect(mocks.httpRequest).toHaveBeenCalledTimes(1);
    expect(mocks.httpsRequest).not.toHaveBeenCalled();
  });

  it("blocks DNS rebinding or mixed DNS answers before opening a connection", async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    await expect(fetchPublicUrlText("https://mixed.example.com")).rejects.toThrow(
      "The destination must resolve only to public IP addresses",
    );
    expect(mocks.httpsRequest).not.toHaveBeenCalled();
  });

  it("follows a validated public HTTPS redirect and returns the body", async () => {
    plans.push(
      { statusCode: 302, headers: { location: "https://next.example.com/document" } },
      { statusCode: 200, headers: { "content-length": "2" }, body: "ok" },
    );

    await expect(fetchPublicUrlText("https://start.example.com")).resolves.toBe("ok");
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(2);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it("supports Node lookup calls that request all address candidates", async () => {
    plans.push({ statusCode: 200, body: "ok" });
    await expect(fetchPublicUrlText("https://start.example.com")).resolves.toBe("ok");

    const requestOptions = mocks.httpsRequest.mock.calls[0]?.[0] as {
      lookup: (
        hostname: string,
        options: { all?: boolean },
        callback: (
          error: Error | null,
          address: string | Array<{ address: string; family: number }>,
          family?: number,
        ) => void,
      ) => void;
    };

    const allAddresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      requestOptions.lookup("start.example.com", { all: true }, (error, address) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address as Array<{ address: string; family: number }>);
      });
    });

    expect(allAddresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("rejects HTTPS-to-HTTP downgrade redirects", async () => {
    plans.push({
      statusCode: 302,
      headers: { location: "http://next.example.com/document" },
    });

    await expect(fetchPublicUrlText("https://start.example.com")).rejects.toThrow(
      "HTTPS redirects to HTTP are not allowed",
    );
    expect(mocks.httpRequest).not.toHaveBeenCalled();
  });

  it("rejects response bodies that exceed the streaming size limit", async () => {
    plans.push({ statusCode: 200, body: Buffer.alloc(1_000_001, 65) });

    await expect(fetchPublicUrlText("https://large.example.com")).rejects.toThrow(
      "The remote response exceeds the size limit",
    );
  });

  it("aborts requests that exceed the fixed request timeout", async () => {
    vi.useFakeTimers();
    plans.push({ statusCode: 200, hang: true });

    const pending = fetchPublicUrlText("https://slow.example.com");
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1);

    const timedOut = expect(pending).rejects.toThrow("The URL request timed out");
    await vi.advanceTimersByTimeAsync(8_001);
    await timedOut;
  });
});
