import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invitation = await prisma.invitation.findUnique({ where: { token } });

  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }
  if (invitation.status !== "PENDING") {
    return NextResponse.json({ error: "This invitation is no longer valid" }, { status: 409 });
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "This invitation has expired" }, { status: 409 });
  }
  if (invitation.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return NextResponse.json(
      { error: `This invitation was sent to ${invitation.email}, not your signed-in email.` },
      { status: 403 },
    );
  }

  await prisma.user.upsert({
    where: { id: user.id },
    update: {},
    create: { id: user.id, email: user.email ?? "" },
  });

  const existingMembership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: invitation.organizationId } },
  });
  if (existingMembership) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED" } });
    return NextResponse.json({ error: "You're already a member of this organization" }, { status: 409 });
  }

  const role = await prisma.role.findUnique({
    where: { organizationId_key: { organizationId: invitation.organizationId, key: invitation.roleKey } },
  });
  if (!role) {
    return NextResponse.json({ error: "Couldn't find the invited role" }, { status: 500 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.create({
      data: { userId: user.id, organizationId: invitation.organizationId, roleId: role.id },
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED" } });
    await tx.activityLog.create({
      data: {
        organizationId: invitation.organizationId,
        actorId: user.id,
        category: "MEMBER",
        action: "member.joined",
        metadata: { email: user.email, roleKey: invitation.roleKey },
      },
    });
  }, { timeout: 15000, maxWait: 10000 });

  return NextResponse.json({ success: true });
}
