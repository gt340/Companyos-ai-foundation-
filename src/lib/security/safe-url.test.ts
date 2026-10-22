import { describe, expect, it } from "vitest";
import { areAllAddressesPublic, isPublicIpAddress, safeRedirectPath, validatePublicHttpUrl } from "./safe-url";

describe("isPublicIpAddress", () => {
  it("accepts representative public IPv4 and IPv6 addresses", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
  });

  it("rejects private, loopback, link-local, reserved, and documentation addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "203.0.113.10",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.1.1",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });
});

  it("rejects DNS answers containing any private or reserved address", () => {
    expect(areAllAddressesPublic([{ address: "93.184.216.34" }, { address: "2606:4700:4700::1111" }])).toBe(true);
    expect(areAllAddressesPublic([{ address: "93.184.216.34" }, { address: "127.0.0.1" }])).toBe(false);
    expect(areAllAddressesPublic([])).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("allows local absolute paths and preserves query strings", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/invite/accept?token=abc")).toBe("/invite/accept?token=abc");
  });

  it("falls back for external, protocol-relative, malformed, and backslash destinations", () => {
    for (const candidate of [
      "https://evil.example",
      "//evil.example/path",
      "\\\\evil.example\\path",
      "/\\evil.example",
      "dashboard",
      " /dashboard",
      "/dashboard\nLocation: https://evil.example",
    ]) {
      expect(safeRedirectPath(candidate)).toBe("/dashboard");
    }
    expect(safeRedirectPath(null)).toBe("/dashboard");
  });

  it("supports an explicit safe fallback", () => {
    expect(safeRedirectPath("https://evil.example", "/login")).toBe("/login");
  });
});

describe("validatePublicHttpUrl", () => {
  it("rejects unsupported schemes before resolving a hostname", async () => {
    await expect(validatePublicHttpUrl("file:///etc/passwd")).rejects.toThrow(
      "Only HTTP and HTTPS URLs are supported",
    );
  });

  it("rejects localhost, private literal IPs, credentials, and non-default ports", async () => {
    await expect(validatePublicHttpUrl("http://localhost")).rejects.toThrow();
    await expect(validatePublicHttpUrl("http://127.0.0.1")).rejects.toThrow();
    await expect(validatePublicHttpUrl("http://169.254.169.254")).rejects.toThrow();
    await expect(validatePublicHttpUrl("https://user:pass@example.com")).rejects.toThrow();
    await expect(validatePublicHttpUrl("http://example.com:8080")).rejects.toThrow();
  });
});
