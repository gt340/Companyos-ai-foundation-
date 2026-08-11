import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createDefaultRoles } from "@/lib/rbac";
import { createOrganizationSchema } from "@/lib/validations/organization";
import { slugify } from "@/lib/utils";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, isActive: true },
    include: { organization: true, role: true },
    orderBy: { joinedAt: "asc" },
  });

  return NextResponse.json({
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      logoUrl: m.organization.logoUrl,
      roleKey: m.role.key,
    })),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createOrganizationSchema.safeParse(body ?? { name: body?.name, slug: slugify(body?.name ?? "") });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  }

  const existingSlug = await prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
  if (existingSlug) {
    return NextResponse.json({ error: "That URL slug is already taken" }, { status: 409 });
  }

  // Ensure the app-side user profile exists before it's referenced by FK.
  await prisma.user.upsert({
    where: { id: user.id },
    update: {},
    create: { id: user.id, email: user.email ?? "" },
  });

  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        ownerId: user.id,
        settings: { create: {} },
      },
    });

    await createDefaultRoles(org.id);

    const ownerRole = await tx.role.findFirstOrThrow({ where: { organizationId: org.id, key: "OWNER" } });

    await tx.membership.create({
      data: { userId: user.id, organizationId: org.id, roleId: ownerRole.id },
    });

    await tx.activityLog.create({
      data: {
        organizationId: org.id,
        actorId: user.id,
        category: "ORGANIZATION",
        action: "organization.created",
      },
    });

    return org;
  });

  return NextResponse.json({ organization }, { status: 201 });
}
