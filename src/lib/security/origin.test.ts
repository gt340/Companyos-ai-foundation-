import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "./origin";

describe("isSameOriginRequest", () => {
  it("accepts an exact same origin", () => {
    expect(isSameOriginRequest("https://company.example/api/write", "https://company.example")).toBe(true);
  });

  it("rejects a different host, scheme, or port", () => {
    expect(isSameOriginRequest("https://company.example/api/write", "https://evil.example")).toBe(false);
    expect(isSameOriginRequest("https://company.example/api/write", "http://company.example")).toBe(false);
    expect(isSameOriginRequest("https://company.example/api/write", "https://company.example:444")).toBe(false);
  });

  it("rejects missing, null, and malformed origins", () => {
    expect(isSameOriginRequest("https://company.example/api/write", null)).toBe(false);
    expect(isSameOriginRequest("https://company.example/api/write", "null")).toBe(false);
    expect(isSameOriginRequest("https://company.example/api/write", "not-a-url")).toBe(false);
  });
});
