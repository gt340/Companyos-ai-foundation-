import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You must be signed in to accept this transfer" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const token = body?.token;

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Missing transfer token" }, { status: 422 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: transfer } = await admin
    .from("ownership_transfers")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (!transfer) {
    return NextResponse.json({ error: "This transfer link is invalid" }, { status: 404 });
  }

  if (transfer.status !== "PENDING") {
    return NextResponse.json({ error: "This transfer is no longer active" }, { status: 400 });
  }

  if (new Date(transfer.expiresAt) < new Date()) {
    await admin.from("ownership_transfers").update({ status: "EXPIRED" }).eq("id", transfer.id);
    return NextResponse.json({ error: "This transfer link has expired" }, { status: 400 });
  }

  if (user.email?.toLowerCase() !== transfer.targetEmail.toLowerCase()) {
    return NextResponse.json(
      { error: `This transfer was sent to ${transfer.targetEmail}. Sign in with that email to accept it.` },
      { status: 403 }
    );
  }

  const organizationId = transfer.organizationId;

  const [ownerRole, adminRole] = await Promise.all([
    prisma.role.findFirstOrThrow({ where: { organizationId, key: "OWNER" } }),
    prisma.role.findFirstOrThrow({ where: { organizationId, key: "ADMIN" } }),
  ]);

  await prisma.$transaction(async (tx) => {
    const existingMembership = await tx.membership.findFirst({
      where: { userId: user.id, organizationId },
    });

    if (existingMembership) {
      await tx.membership.update({
        where: { id: existingMembership.id },
        data: { roleId: ownerRole.id, isActive: true },
      });
    } else {
      await tx.membership.create({
        data: { userId: user.id, organizationId, roleId: ownerRole.id },
      });
    }

    await tx.membership.updateMany({
      where: { userId: transfer.currentOwnerId, organizationId },
      data: { roleId: adminRole.id },
    });

    await tx.organization.update({
      where: { id: organizationId },
      data: { ownerId: user.id },
    });

    await tx.activityLog.create({
      data: {
        organizationId,
        actorId: user.id,
        category: "ORGANIZATION",
        action: "organization.ownership_transferred",
        metadata: { previousOwnerId: transfer.currentOwnerId, newOwnerId: user.id },
      },
    });
  });

  await admin
    .from("ownership_transfers")
    .update({ status: "ACCEPTED", respondedAt: new Date().toISOString() })
    .eq("id", transfer.id);

  return NextResponse.json({ success: true, organizationId });
    }
