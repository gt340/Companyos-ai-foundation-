// src/lib/zoom/zoom-connection.ts
// Per-company Zoom connection helpers.
//
// Each organization connects its OWN Zoom account (company-level, connected
// by an owner or admin) through Zoom's standard OAuth flow, so one company can
// never create or cancel meetings on another company's Zoom.
//
// Server environment variables for the platform's single Zoom OAuth app
// (a Zoom "General app" with user-managed OAuth, not the Server-to-Server one):
//   ZOOM_OAUTH_CLIENT_ID
//   ZOOM_OAUTH_CLIENT_SECRET
// Redirect URL to register in that Zoom app:
//   <app url>/api/auth/zoom/callback
// App scopes needed: meeting:write:meeting, meeting:read:list_meetings,
// meeting:delete:meeting, user:read:user

import { prisma } from "@/lib/prisma";

export const ZOOM_AUTHORIZE_URL = "https://zoom.us/oauth/authorize";
export const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
export const ZOOM_REVOKE_URL = "https://zoom.us/oauth/revoke";
export const ZOOM_API = "https://api.zoom.us/v2";

// NEXT_PUBLIC_APP_URL may be set without a scheme; normalize defensively.
export function zoomAppBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://companyos-ai-foundation.vercel.app";
  return raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : `https://${raw}`;
}

export interface ZoomOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getZoomOAuthConfig(): ZoomOAuthConfig | null {
  const clientId = process.env.ZOOM_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ZOOM_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${zoomAppBaseUrl()}/api/auth/zoom/callback`,
  };
}

export function zoomBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

// Only company owners and admins may connect or disconnect the company Zoom.
export async function userCanManageZoom(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: { userId, organizationId, isActive: true },
    select: { role: { select: { key: true } } },
  });
  const key = membership?.role.key;
  return key === "OWNER" || key === "ADMIN";
}

// Returns a valid access token for the organization's Zoom connection,
// refreshing it first if it is about to expire. Returns null when the
// organization has not connected Zoom.
export async function getOrgZoomAccessToken(
  organizationId: string
): Promise<string | null> {
  const connection = await prisma.zoomConnection.findUnique({
    where: { organizationId },
  });
  if (!connection) return null;

  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }

  const config = getZoomOAuthConfig();
  if (!config) {
    throw new Error(
      "Zoom sign-in is not configured on the server (ZOOM_OAUTH_CLIENT_ID / ZOOM_OAUTH_CLIENT_SECRET), so the company's Zoom token could not be refreshed."
    );
  }

  const res = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: zoomBasicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    throw new Error(
      "The company's Zoom connection has expired or was revoked. A company owner or admin needs to reconnect Zoom at /integrations."
    );
  }

  // Zoom rotates the refresh token on every refresh, so the new one must be saved.
  await prisma.zoomConnection.update({
    where: { organizationId },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? connection.refreshToken,
      expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
      ...(data.scope ? { scopes: String(data.scope).split(" ") } : {}),
    },
  });

  return data.access_token as string;
}
