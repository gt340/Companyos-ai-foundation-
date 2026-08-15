import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getPrimaryMembership } from "@/lib/rbac";
import { inviteMemberSchema } from "@/lib/validations/organization";

const INVITATION_TTL_DAYS = 7;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await getPrimaryMembership(user.id);
  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const canInvite = membership.role.permissions.some((rp) => rp.permission.key === "member.invite");
  if (!canInvite) {
    return NextResponse.json({ error: "You don't have permission to do this" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = inviteMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  }

  const existingMember = await prisma.membership.findFirst({
    where: { organizationId: membership.organizationId, user: { email: parsed.data.email } },
  });
  if (existingMember) {
    return NextResponse.json({ error: "That person is already a member" }, { status: 409 });
  }

  const existingInvite = await prisma.invitation.findFirst({
    where: { organizationId: membership.organizationId, email: parsed.data.email, status: "PENDING" },
  });
  if (existingInvite) {
    return NextResponse.json({ error: "An invitation is already pending for that email" }, { status: 409 });
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: membership.organizationId,
      email: parsed.data.email,
      roleKey: parsed.data.roleKey,
      token,
      invitedById: user.id,
      expiresAt,
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: membership.organizationId,
      actorId: user.id,
      category: "MEMBER",
      action: "member.invited",
      metadata: { email: parsed.data.email, roleKey: parsed.data.roleKey },
    },
  });

  return NextResponse.json(
    {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        roleKey: invitation.roleKey,
        expiresAt: invitation.expiresAt,
        inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invitations/${token}`,
      },
    },
    { status: 201 },
  );
    }
