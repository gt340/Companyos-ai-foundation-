import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import {
  ZOOM_AUTHORIZE_URL,
  getZoomOAuthConfig,
  userCanManageZoom,
  zoomAppBaseUrl,
} from "@/lib/zoom/zoom-connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fail(base: string, message: string) {
  return NextResponse.redirect(
    `${base}/integrations?zoom=error&message=${encodeURIComponent(message)}`
  );
}

// Starts the Zoom OAuth flow for the user's active company. Only a company
// owner or admin may connect Zoom, because the connection is company-wide.
export async function GET() {
  const base = zoomAppBaseUrl();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${base}/login`);

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) return fail(base, "No active company found.");

  if (!(await userCanManageZoom(user.id, organizationId))) {
    return fail(base, "Only a company owner or admin can connect Zoom.");
  }

  const config = getZoomOAuthConfig();
  if (!config) {
    return fail(base, "Zoom sign-in is not configured on the server yet.");
  }

  // Random per-attempt state, stored with the company id in an httpOnly
  // cookie and checked again in the callback (CSRF protection, and it pins
  // the connection to the company that started the flow).
  const state = crypto.randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });

  const response = NextResponse.redirect(`${ZOOM_AUTHORIZE_URL}?${params.toString()}`);
  response.cookies.set("zoom_oauth_state", `${state}:${organizationId}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
