import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ACTIVE_ORG_COOKIE_NAME } from "@/lib/active-org";

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const organizationId = body?.organizationId;

  if (!organizationId || typeof organizationId !== "string") {
    return NextResponse.json({ error: "organizationId is required" }, { status: 422 });
  }

  // Never trust the client's claim — confirm this user actually belongs
  // to the organization they're asking to switch into.
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, organizationId, isActive: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "You are not a member of that organization" }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE_NAME, organizationId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
  });

  return NextResponse.json({ organizationId });
}
