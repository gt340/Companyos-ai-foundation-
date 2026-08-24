import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
  const isMfaChallengeRoute = request.nextUrl.pathname.startsWith("/mfa-challenge");

  const isVerified = Boolean(user?.email_confirmed_at);

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (user && !isVerified && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/verify-email";
    return NextResponse.redirect(url);
  }

  // Enforce the 2FA challenge: if this user has a verified TOTP factor but
  // the current session hasn't completed it yet, keep them out of protected
  // routes until they do — while still letting them reach the challenge page itself.
  if (user && isVerified && isProtected) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = "/mfa-challenge";
      url.searchParams.set("redirectTo", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  }

  if (user && isVerified && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && isVerified && isVerifyEmailRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Once fully verified (aal2 satisfied or not required), there's no reason
  // to sit on the challenge page — send them where they meant to go.
  if (user && isMfaChallengeRoute) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel === aal.nextLevel) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
