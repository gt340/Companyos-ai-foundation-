import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getPrimaryMembership } from "@/lib/rbac";
import { updateOrganizationSchema } from "@/lib/validations/organization";

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
  const parsed = updateOrganizationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  }

  if (parsed.data.slug !== membership.organization.slug) {
    const existing = await prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) {
      return NextResponse.json({ error: "That URL slug is already taken" }, { status: 409 });
    }
  }

  const organization = await prisma.organization.update({
    where: { id: membership.organizationId },
    data: { name: parsed.data.name, slug: parsed.data.slug },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: membership.organizationId,
      actorId: user.id,
      category: "ORGANIZATION",
      action: "organization.updated",
      metadata: { name: parsed.data.name, slug: parsed.data.slug },
    },
  });

  return NextResponse.json({ organization });
    }
