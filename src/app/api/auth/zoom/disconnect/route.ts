import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import { prisma } from "@/lib/prisma";
import {
  ZOOM_REVOKE_URL,
  getZoomOAuthConfig,
  userCanManageZoom,
  zoomAppBaseUrl,
  zoomBasicAuthHeader,
} from "@/lib/zoom/zoom-connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Disconnects the company's Zoom. Only an owner or admin may do this.
export async function POST() {
  const base = zoomAppBaseUrl();
  // 303 so the browser follows the redirect with a GET after a form POST.
  const redirect = (query: string) =>
    NextResponse.redirect(`${base}/integrations?${query}`, 303);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${base}/login`, 303);

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) {
    return redirect(`zoom=error&message=${encodeURIComponent("No active company found.")}`);
  }

  if (!(await userCanManageZoom(user.id, organizationId))) {
    return redirect(
      `zoom=error&message=${encodeURIComponent("Only a company owner or admin can disconnect Zoom.")}`
    );
  }

  const connection = await prisma.zoomConnection.findUnique({ where: { organizationId } });

  // Best effort: tell Zoom to revoke the token. The local connection is
  // removed regardless of whether Zoom's revoke call succeeds.
  const config = getZoomOAuthConfig();
  if (connection && config) {
    try {
      await fetch(`${ZOOM_REVOKE_URL}?${new URLSearchParams({ token: connection.accessToken })}`, {
        method: "POST",
        headers: {
          Authorization: zoomBasicAuthHeader(config.clientId, config.clientSecret),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
    } catch {
      // ignore - removing our stored copy of the tokens is what matters here
    }
  }

  await prisma.zoomConnection.deleteMany({ where: { organizationId } });

  return redirect("zoom=disconnected");
}
