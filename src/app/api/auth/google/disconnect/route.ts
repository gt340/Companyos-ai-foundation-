import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://companyos-ai-foundation.vercel.app";

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
