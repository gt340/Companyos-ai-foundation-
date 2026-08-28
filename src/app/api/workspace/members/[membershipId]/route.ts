import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganizationId } from "@/lib/active-org";

async function getMemberPermissions(userId: string, organizationId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, organizationId, isActive: true },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  const permissions = membership?.role.permissions.map((p) => p.permission.key) ?? [];
  return {
    membership,
    canAssignRole: permissions.includes("role.assign"),
    canRemove: permissions.includes("member.remove"),
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const { canAssignRole } = await getMemberPermissions(user.id, organizationId);
  if (!canAssignRole) {
    return NextResponse.json({ error: "You don't have permission to manage members" }, { status: 403 });
  }

  const target = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { role: true },
  });

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.role.key === "OWNER") {
    return NextResponse.json(
      { error: "Use ownership transfer to change the owner's role" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const newRoleKey = body?.roleKey;

  if (!newRoleKey || !["ADMIN", "MEMBER", "VIEWER"].includes(newRoleKey)) {
    return NextResponse.json({ error: "roleKey must be ADMIN, MEMBER, or VIEWER" }, { status: 422 });
  }

  const newRole = await prisma.role.findFirstOrThrow({
    where: { organizationId, key: newRoleKey },
  });

  await prisma.$transaction([
    prisma.membership.update({
      where: { id: membershipId },
      data: { roleId: newRole.id },
    }),
    prisma.activityLog.create({
      data: {
        organizationId,
        actorId: user.id,
        category: "MEMBER",
        action: "member.role_changed",
        metadata: { targetUserId: target.userId, previousRole: target.role.key, newRole: newRoleKey },
      },
    }),
  ]);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const { canRemove } = await getMemberPermissions(user.id, organizationId);
  if (!canRemove) {
    return NextResponse.json({ error: "You don't have permission to manage members" }, { status: 403 });
  }

  const target = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { role: true },
  });

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.role.key === "OWNER") {
    return NextResponse.json({ error: "The owner cannot be removed" }, { status: 400 });
  }

  if (target.userId === user.id) {
    return NextResponse.json({ error: "You can't remove yourself this way" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.membership.update({
      where: { id: membershipId },
      data: { isActive: false },
    }),
    prisma.activityLog.create({
      data: {
        organizationId,
        actorId: user.id,
        category: "MEMBER",
        action: "member.removed",
        metadata: { targetUserId: target.userId, removedRole: target.role.key },
      },
    }),
  ]);

  return NextResponse.json({ success: true });
}
