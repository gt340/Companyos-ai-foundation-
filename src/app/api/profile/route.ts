import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

const patchProfileSchema = z.object({
  fullName: z.string().min(2).max(100),
  jobTitle: z.string().max(100).optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  timezone: z.string().min(1),
  avatarUrl: z.string().url().optional().or(z.literal("")),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.user.findUnique({ where: { id: user.id } });

  return NextResponse.json({
    profile: profile ?? {
      id: user.id,
      email: user.email ?? "",
      fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
      jobTitle: null,
      phone: null,
      avatarUrl: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  }

  const updated = await prisma.user.upsert({
    where: { id: user.id },
    update: {
      fullName: parsed.data.fullName,
      jobTitle: parsed.data.jobTitle || null,
      phone: parsed.data.phone || null,
      timezone: parsed.data.timezone,
      avatarUrl: parsed.data.avatarUrl || undefined,
    },
    create: {
      id: user.id,
      email: user.email ?? "",
      fullName: parsed.data.fullName,
      jobTitle: parsed.data.jobTitle || null,
      phone: parsed.data.phone || null,
      timezone: parsed.data.timezone,
      avatarUrl: parsed.data.avatarUrl || null,
    },
  });

  return NextResponse.json({ user: updated });
  }
