import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every matched request and
 * returns the (possibly redirected) response for middleware.ts to use.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedPrefixes = [
    "/dashboard",
    "/settings",
    "/profile",
    "/onboarding",
    "/billing",
    "/notifications",
    "/activity-logs",
  ];
  const isProtected = protectedPrefixes.some((p) => request.nextUrl.pathname.startsWith(p));
  const isAuthRoute = ["/login", "/register", "/forgot-password"].some((p) =>
    request.nextUrl.pathname.startsWith(p),
  );
  const isVerifyEmailRoute = request.nextUrl.pathname.startsWith("/verify-email");

  const isVerified = Boolean(user?.email_confirmed_at);

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Signed in but hasn't verified their email yet: keep them out of
  // protected areas until they confirm, but let them stay on the
  // verify-email page itself.
  if (user && !isVerified && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/verify-email";
    return NextResponse.redirect(url);
  }

  if (user && isVerified && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // A verified user has no reason to sit on the verify-email page.
  if (user && isVerified && isVerifyEmailRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
