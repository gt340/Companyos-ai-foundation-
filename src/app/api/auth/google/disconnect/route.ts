import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same normalization as connect/callback — NEXT_PUBLIC_APP_URL may be
// set without a scheme in Vercel; a redirect without one is still
// technically invalid even though Google never sees this particular URL.
function resolveAppBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "https://companyos-ai-foundation.vercel.app";
  return raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
}

const APP_BASE_URL = resolveAppBaseUrl();

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${APP_BASE_URL}/login`);
  }

  await prisma.googleConnection.deleteMany({ where: { userId: user.id } });

  return NextResponse.redirect(`${APP_BASE_URL}/integrations?google=disconnected`);
}
