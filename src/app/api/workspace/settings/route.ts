import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getPrimaryMembership } from "@/lib/rbac";

const patchSettingsSchema = z.object({
  requireTwoFactor: z.boolean().optional(),
  sessionTimeoutMinutes: z.coerce.number().int().min(15).max(43200).optional(),
  notifyOnNewMember: z.boolean().optional(),
  notifyOnBillingEvents: z.boolean().optional(),
});

export async function PATCH(request: Request) {
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

  const canManage = membership.role.permissions.some((rp) => rp.permission.key === "organization.manage");
  if (!canManage) {
    return NextResponse.json({ error: "You don't have permission to do this" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  }

  const settings = await prisma.organizationSettings.upsert({
    where: { organizationId: membership.organizationId },
    update: parsed.data,
    create: { organizationId: membership.organizationId, ...parsed.data },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: membership.organizationId,
      actorId: user.id,
      category: "SETTINGS",
      action: "settings.updated",
      metadata: parsed.data,
    },
  });

  return NextResponse.json({ settings });
    }
