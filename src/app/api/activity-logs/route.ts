import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      isActive: true,
      ...(organizationId ? { organizationId } : {}),
    },
  });

  if (!membership) {
    return NextResponse.json({ logs: [] });
  }

  const logs = await prisma.activityLog.findMany({
    where: { organizationId: membership.organizationId },
    include: { actor: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ logs });
}
