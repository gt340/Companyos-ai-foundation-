import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findFirst: vi.fn() },
    zoomConnection: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/security/token-crypto", () => ({
  decryptToken: vi.fn((value: string) => value),
  encryptToken: vi.fn((value: string) => value),
  encryptionEnabled: vi.fn(() => false),
  isEncrypted: vi.fn(() => false),
}));

import { getZoomOAuthConfig } from "./zoom-connection";

describe("getZoomOAuthConfig", () => {
  beforeEach(() => {
    vi.stubEnv("ZOOM_CLIENT_ID", "");
    vi.stubEnv("ZOOM_CLIENT_SECRET", "");
    vi.stubEnv("ZOOM_OAUTH_CLIENT_ID", "");
    vi.stubEnv("ZOOM_OAUTH_CLIENT_SECRET", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://companyos-ai-foundation.vercel.app");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the canonical ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET variables", () => {
    vi.stubEnv("ZOOM_CLIENT_ID", "client-id");
    vi.stubEnv("ZOOM_CLIENT_SECRET", "client-secret");

    expect(getZoomOAuthConfig()).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://companyos-ai-foundation.vercel.app/api/auth/zoom/callback",
    });
  });

  it("prefers canonical variables when both canonical and legacy names exist", () => {
    vi.stubEnv("ZOOM_CLIENT_ID", "canonical-id");
    vi.stubEnv("ZOOM_CLIENT_SECRET", "canonical-secret");
    vi.stubEnv("ZOOM_OAUTH_CLIENT_ID", "legacy-id");
    vi.stubEnv("ZOOM_OAUTH_CLIENT_SECRET", "legacy-secret");

    expect(getZoomOAuthConfig()).toMatchObject({
      clientId: "canonical-id",
      clientSecret: "canonical-secret",
    });
  });

  it("supports legacy OAuth variable names for backward compatibility", () => {
    vi.stubEnv("ZOOM_OAUTH_CLIENT_ID", "legacy-id");
    vi.stubEnv("ZOOM_OAUTH_CLIENT_SECRET", "legacy-secret");

    expect(getZoomOAuthConfig()).toMatchObject({
      clientId: "legacy-id",
      clientSecret: "legacy-secret",
    });
  });

  it("returns null if either credential is missing", () => {
    vi.stubEnv("ZOOM_CLIENT_ID", "client-id");
    expect(getZoomOAuthConfig()).toBeNull();

    vi.stubEnv("ZOOM_CLIENT_SECRET", "client-secret");
    vi.stubEnv("ZOOM_CLIENT_ID", "");
    expect(getZoomOAuthConfig()).toBeNull();
  });
});
