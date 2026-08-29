import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
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

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization || organization.ownerId !== user.id) {
    return NextResponse.json({ error: "Only the current owner can transfer ownership" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const targetEmail = (body?.targetEmail as string | undefined)?.trim().toLowerCase();

  if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 422 });
  }

  const requester = await prisma.user.findUnique({ where: { id: user.id } });
  if (requester?.email?.toLowerCase() === targetEmail) {
    return NextResponse.json({ error: "You already own this organization" }, { status: 400 });
  }

  // Cancel any existing pending transfer for this org before starting a new one.
  await prisma.ownershipTransfer.updateMany({
    where: { organizationId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  const targetUser = await prisma.user.findUnique({ where: { email: targetEmail } });
  const token = randomBytes(24).toString("hex");

  const transfer = await prisma.ownershipTransfer.create({
    data: {
      organizationId,
      currentOwnerId: user.id,
      targetEmail,
      targetUserId: targetUser?.id ?? null,
      token,
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId,
      actorId: user.id,
      category: "ORGANIZATION",
      action: "organization.ownership_transfer_initiated",
      metadata: { targetEmail },
    },
  });

  const baseUrl = new URL(request.url).origin;
  const transferUrl = `${baseUrl}/transfer-ownership/${token}`;

  return NextResponse.json({ transfer: { id: transfer.id, targetEmail, transferUrl, expiresAt: transfer.expiresAt } });
}
