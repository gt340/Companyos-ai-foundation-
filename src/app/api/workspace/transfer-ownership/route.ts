import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganizationId } from "@/lib/active-org";

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  const newOwnerUserId = body?.newOwnerUserId;
  if (!newOwnerUserId || typeof newOwnerUserId !== "string") {
    return NextResponse.json({ error: "newOwnerUserId is required" }, { status: 422 });
  }

  // Confirm the requester is genuinely the current owner — never trust
  // client-side role claims for something this sensitive.
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!organization || organization.ownerId !== user.id) {
    return NextResponse.json({ error: "Only the current owner can transfer ownership" }, { status: 403 });
  }

  if (newOwnerUserId === user.id) {
    return NextResponse.json({ error: "You already own this organization" }, { status: 400 });
  }

  const targetMembership = await prisma.membership.findFirst({
    where: { userId: newOwnerUserId, organizationId, isActive: true },
  });

  if (!targetMembership) {
    return NextResponse.json({ error: "That person isn't an active member of this organization" }, { status: 404 });
  }

  const [ownerRole, adminRole] = await Promise.all([
    prisma.role.findFirstOrThrow({ where: { organizationId, key: "OWNER" } }),
    prisma.role.findFirstOrThrow({ where: { organizationId, key: "ADMIN" } }),
  ]);

  await prisma.$transaction(async (tx) => {
    // Move the target member into the OWNER role.
    await tx.membership.update({
      where: { id: targetMembership.id },
      data: { roleId: ownerRole.id },
    });

    // Step the outgoing owner down to Admin rather than leaving them
    // without any role — they keep access, just not ownership.
    await tx.membership.updateMany({
      where: { userId: user.id, organizationId },
      data: { roleId: adminRole.id },
    });

    await tx.organization.update({
      where: { id: organizationId },
      data: { ownerId: newOwnerUserId },
    });

    await tx.activityLog.create({
      data: {
        organizationId,
        actorId: user.id,
        category: "ORGANIZATION",
        action: "organization.ownership_transferred",
        metadata: { previousOwnerId: user.id, newOwnerId: newOwnerUserId },
      },
    });
  });

  return NextResponse.json({ success: true });
}
