import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();
  const isUnsafeMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");

  if (
    isApiRequest &&
    isUnsafeMethod &&
    !isSameOriginRequest(request.nextUrl.toString(), request.headers.get("origin"))
  ) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and image
     * optimization files, so the auth session refreshes on every
     * navigable route without wasting cycles on `_next` internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
