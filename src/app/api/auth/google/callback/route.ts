import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://companyos-ai-foundation.vercel.app";

function redirectToIntegrations(status: "connected" | "disconnected" | "error", message?: string) {
  const target = new URL(`${APP_BASE_URL}/integrations`);
  target.searchParams.set("google", status);
  if (message) target.searchParams.set("message", message);
  return NextResponse.redirect(target.toString());
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    // e.g. the user clicked "Cancel" on Google's consent screen
    return redirectToIntegrations("error", errorParam);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${APP_BASE_URL}/login`);
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieState = cookieHeader.match(/google_oauth_state=([^;]+)/)?.[1];

  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectToIntegrations(
      "error",
      "State mismatch or missing authorization code — please try connecting again."
    );
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${APP_BASE_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(
        tokenData.error_description ?? tokenData.error ?? "Google token exchange failed."
      );
    }

    if (!tokenData.refresh_token) {
      // prompt=consent in /connect is specifically what guarantees this is
      // present — if it's still missing, something's off with the OAuth
      // client configuration itself, not a one-off user error.
      throw new Error(
        "Google didn't return a refresh token. Check that your OAuth client is configured for offline access, then try reconnecting."
      );
    }

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userInfoRes.json();

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    const scopes: string[] = ((tokenData.scope as string) ?? "").split(" ").filter(Boolean);

    await prisma.googleConnection.upsert({
      where: { userId: user.id },
      update: {
        connectedEmail: userInfo.email ?? "unknown",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        scopes,
        expiresAt,
      },
      create: {
        userId: user.id,
        connectedEmail: userInfo.email ?? "unknown",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        scopes,
        expiresAt,
      },
    });

    const response = redirectToIntegrations("connected");
    response.cookies.delete("google_oauth_state");
    return response;
  } catch (err) {
    return redirectToIntegrations("error", err instanceof Error ? err.message : "Unknown error");
  }
}
