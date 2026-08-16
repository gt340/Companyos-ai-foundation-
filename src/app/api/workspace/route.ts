import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getPrimaryMembership } from "@/lib/rbac";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getPrimaryMembership(user.id);

  if (!membership) {
    return NextResponse.json({ organization: null });
  }

  const [members, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: membership.organizationId, isActive: true },
      include: { user: true, role: true },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { organizationId: membership.organizationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
    },
    settings: membership.organization.settings,
    currentRole: membership.role.key,
    permissions: membership.role.permissions.map((rp) => rp.permission.key),
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      fullName: m.user.fullName,
      email: m.user.email,
      roleKey: m.role.key,
      isCurrentUser: m.userId === user.id,
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      roleKey: i.roleKey,
      expiresAt: i.expiresAt,
    })),
  });
      }
