import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

/**
 * Handles the redirect from Supabase's email links (verification,
 * magic link, password recovery). Exchanges the auth code for a
 * session, then mirrors the Supabase user into our `User` table so
 * the rest of the app has a profile row to attach memberships,
 * activity, and notifications to.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      await prisma.user.upsert({
        where: { id: data.user.id },
        update: {
          email: data.user.email ?? "",
          emailVerified: Boolean(data.user.email_confirmed_at),
          lastLoginAt: new Date(),
        },
        create: {
          id: data.user.id,
          email: data.user.email ?? "",
          fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
          emailVerified: Boolean(data.user.email_confirmed_at),
          lastLoginAt: new Date(),
        },
      });

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
