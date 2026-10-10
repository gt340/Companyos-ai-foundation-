import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Full Gmail (read + send), full Drive, and full Calendar — per the
// user's explicit choice. Note: gmail full-send and drive full access
// are Google "restricted" scopes; moving this app from testing to a
// public listing later requires Google's CASA security assessment for
// these specific scopes. Not a blocker today (testing mode with
// manually-added test users works immediately), but a real future cost.
// YouTube (read-only data + read-only analytics, and upload) was added
// later; an account connected before a scope was added must disconnect
// and reconnect to grant it.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/userinfo.email",
];

// NEXT_PUBLIC_APP_URL may be set in Vercel without a scheme (e.g. just
// "companyos-ai-foundation.vercel.app") — Google rejects a redirect_uri
// with no scheme outright as an "invalid_request", before even checking
// if it matches what's registered. Normalize defensively here rather
// than trusting the env var's exact format.
function resolveAppBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "https://companyos-ai-foundation.vercel.app";
  return raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
}

const APP_BASE_URL = resolveAppBaseUrl();

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${APP_BASE_URL}/login`);
  }

  // Random per-attempt state, stored in an httpOnly cookie and checked
  // again in the callback — the real CSRF protection for this OAuth flow,
  // not just a formality.
  const state = crypto.randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${APP_BASE_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent", // forces the consent screen every time, which is what guarantees Google actually issues a refresh_token (it otherwise only does this on a user's very first-ever consent)
    state,
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );

  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes — plenty for the redirect round trip
    path: "/",
  });

  return response;
}
