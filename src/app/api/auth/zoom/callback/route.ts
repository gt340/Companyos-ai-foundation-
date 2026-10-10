import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  ZOOM_API,
  ZOOM_TOKEN_URL,
  getZoomOAuthConfig,
  userCanManageZoom,
  zoomAppBaseUrl,
  zoomBasicAuthHeader,
} from "@/lib/zoom/zoom-connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function done(base: string, query: string) {
  const response = NextResponse.redirect(`${base}/integrations?${query}`);
  response.cookies.delete("zoom_oauth_state");
  return response;
}

function fail(base: string, message: string) {
  return done(base, `zoom=error&message=${encodeURIComponent(message)}`);
}

export async function GET(req: Request) {
  const base = zoomAppBaseUrl();
  const url = new URL(req.url);

  const zoomError = url.searchParams.get("error");
  if (zoomError) {
    return fail(base, url.searchParams.get("error_description") ?? zoomError);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail(base, "Zoom did not return an authorization code.");

  // Check the state against the cookie set when the flow started.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get("zoom_oauth_state")?.value ?? "";
  const [cookieState, organizationId] = cookieValue.split(":");
  if (!cookieState || !organizationId || cookieState !== state) {
    return fail(base, "The Zoom sign-in attempt expired or was invalid. Please try again.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${base}/login`);

  // Re-check permission: the person finishing the flow must still be an
  // owner or admin of the company that started it.
  if (!(await userCanManageZoom(user.id, organizationId))) {
    return fail(base, "Only a company owner or admin can connect Zoom.");
  }

  const config = getZoomOAuthConfig();
  if (!config) return fail(base, "Zoom sign-in is not configured on the server yet.");

  // Exchange the code for tokens.
  const tokenRes = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: zoomBasicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokens: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.access_token || !tokens.refresh_token) {
    return fail(
      base,
      tokens.reason ?? tokens.error ?? "Zoom did not accept the sign-in. Please try again."
    );
  }

  // Find out which Zoom account was connected (shown in the UI).
  const meRes = await fetch(`${ZOOM_API}/users/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const me: any = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.email) {
    return fail(base, "Connected to Zoom, but could not read the Zoom account details.");
  }

  const data = {
    connectedByUserId: user.id,
    zoomAccountId: String(me.account_id ?? ""),
    connectedEmail: String(me.email),
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    scopes: tokens.scope ? String(tokens.scope).split(" ") : [],
    expiresAt: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000),
  };

  await prisma.zoomConnection.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });

  return done(base, "zoom=connected");
}
