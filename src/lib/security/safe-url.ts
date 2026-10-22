import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const REDIRECT_FALLBACK = "/dashboard";

export class SafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeUrlError";
  }
}

function ipv4Number(address: string): number | null {
  const octets = address.split(".");
  if (octets.length !== 4) return null;
  const values = octets.map((part) => Number(part));
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return ((((values[0]! * 256 + values[1]!) * 256 + values[2]!) * 256 + values[3]!) >>> 0);
}

function inIpv4Range(value: number, network: string, prefix: number): boolean {
  const base = ipv4Number(network);
  if (base === null) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;

  const nonPublicRanges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return !nonPublicRanges.some(([network, prefix]) => inIpv4Range(value, network, prefix));
}

function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase().split("%")[0] ?? "";

  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = value.slice(lastColon + 1);
    const number = ipv4Number(ipv4);
    if (number === null) return null;
    value = value.slice(0, lastColon) + ":" + (number >>> 16).toString(16) + ":" + (number & 0xffff).toString(16);
  }

  const parts = value.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const missing = 8 - left.length - right.length;

  if ((parts.length === 1 && missing !== 0) || (parts.length === 2 && missing < 1)) return null;

  const groups = [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ];
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

function isPublicIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return false;

  // IPv4-mapped IPv6 addresses inherit the embedded IPv4 address policy.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const number = groups[6]! * 0x10000 + groups[7]!;
    const ipv4 = [
      (number >>> 24) & 255,
      (number >>> 16) & 255,
      (number >>> 8) & 255,
      number & 255,
    ].join(".");
    return isPublicIpv4(ipv4);
  }

  const first = groups[0]!;
  const second = groups[1]!;

  // Permit global-unicast 2000::/3 only; reject special-purpose ranges,
  // 6to4, and documentation space.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && second <= 0x01ff) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff) return false;

  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.split("%")[0] ?? "";
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

function parseAllowedUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeUrlError("Enter a valid public HTTP or HTTPS URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeUrlError("Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) {
    throw new SafeUrlError("URLs containing credentials are not allowed");
  }
  if (url.port) {
    throw new SafeUrlError("Only the default HTTP and HTTPS ports are allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".example")
  ) {
    throw new SafeUrlError("The destination host is not allowed");
  }

  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new SafeUrlError("Private or reserved IP destinations are not allowed");
    }
  } else if (!hostname.includes(".")) {
    throw new SafeUrlError("Single-label hostnames are not allowed");
  }

  return url;
}

interface ResolvedPublicUrl {
  url: URL;
  hostname: string;
  address: LookupAddress;
}

async function resolvePublicUrl(input: string | URL): Promise<ResolvedPublicUrl> {
  const url = parseAllowedUrl(input.toString());
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const family = isIP(hostname);

  if (family) {
    return {
      url,
      hostname,
      address: { address: hostname, family },
    };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeUrlError("The destination hostname could not be resolved");
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new SafeUrlError("The destination must resolve only to public IP addresses");
  }

  // Pin the validated address into the actual request to prevent DNS rebinding
  // between validation and connection establishment.
  return { url, hostname, address: addresses[0]! };
}

export async function validatePublicHttpUrl(input: string): Promise<URL> {
  return (await resolvePublicUrl(input)).url;
}

interface FetchResponse {
  statusCode: number;
  location?: string;
  body: string;
}

function requestPinnedUrl(target: ResolvedPublicUrl): Promise<FetchResponse> {
  const { url, hostname, address } = target;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (response: FetchResponse) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(response);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error instanceof SafeUrlError ? error : new SafeUrlError("Could not fetch the public URL"));
    };

    const pinnedLookup = ((_: string, _options: unknown, callback: (...args: unknown[]) => void) => {
      callback(null, address.address, address.family);
    }) as unknown as LookupFunction;

    const options = {
      hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      method: "GET",
      path: url.pathname + url.search,
      headers: {
        "User-Agent": "CompanyOS-KnowledgeBase/1.0",
        Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "identity",
      },
      agent: false,
      lookup: pinnedLookup,
    };

    const onResponse = (response: import("node:http").IncomingMessage) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;
      const isRedirect = REDIRECT_STATUSES.has(statusCode);

      if (isRedirect) {
        finish({ statusCode, location, body: "" });
        response.destroy();
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        finish({ statusCode, body: "" });
        response.destroy();
        return;
      }

      const contentEncoding = response.headers["content-encoding"];
      if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
        fail(new SafeUrlError("Compressed URL responses are not supported"));
        response.destroy();
        return;
      }

      const contentLength = Number(response.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        fail(new SafeUrlError("The remote response exceeds the size limit"));
        response.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          fail(new SafeUrlError("The remote response exceeds the size limit"));
          response.destroy();
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        finish({ statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
      response.on("error", () => {
        fail(new SafeUrlError("Could not read the remote response"));
      });
    };

    const request =
      url.protocol === "https:"
        ? httpsRequest(
            {
              ...options,
              servername: isIP(hostname) ? undefined : hostname,
            },
            onResponse,
          )
        : httpRequest(options, onResponse);

    timer = setTimeout(() => {
      request.destroy(new SafeUrlError("The URL request timed out"));
    }, REQUEST_TIMEOUT_MS);

    request.on("error", (error: Error) => {
      fail(error);
    });
    request.end();
  });
}

export async function fetchPublicUrlText(input: string): Promise<string> {
  let target = await resolvePublicUrl(input);

  for (let redirects = 0; ; redirects += 1) {
    const response = await requestPinnedUrl(target);

    if (REDIRECT_STATUSES.has(response.statusCode)) {
      if (!response.location) {
        throw new SafeUrlError("The remote server returned an invalid redirect");
      }
      if (redirects >= MAX_REDIRECTS) {
        throw new SafeUrlError("The URL exceeded the redirect limit");
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(response.location, target.url);
      } catch {
        throw new SafeUrlError("The remote server returned an invalid redirect");
      }

      if (target.url.protocol === "https:" && nextUrl.protocol !== "https:") {
        throw new SafeUrlError("HTTPS redirects to HTTP are not allowed");
      }

      target = await resolvePublicUrl(nextUrl);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new SafeUrlError("The remote server returned HTTP " + response.statusCode);
    }

    return response.body;
  }
}

export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback = REDIRECT_FALLBACK,
): string {
  if (
    !candidate ||
    candidate !== candidate.trim() ||
    candidate.startsWith("//") ||
    !candidate.startsWith("/") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://companyos.invalid");
    if (parsed.origin !== "https://companyos.invalid") return fallback;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}
