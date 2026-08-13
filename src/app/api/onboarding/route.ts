import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createDefaultRoles } from "@/lib/rbac";
import { onboardingSchema } from "@/lib/validations/onboarding";
import { slugify } from "@/lib/utils";

/**
 * Saves the company profile collected during onboarding. If the user
 * has no organization yet (fresh sign-up), one is auto-provisioned
 * from the company name so onboarding can run as a single step.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  }

  await prisma.user.upsert({
    where: { id: user.id },
    update: {},
    create: { id: user.id, email: user.email ?? "" },
  });

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, isActive: true },
  });

  const organizationId = await prisma.$transaction(async (tx) => {
    if (membership) return membership.organizationId;

    const baseSlug = slugify(parsed.data.name) || "company";
    let slug = baseSlug;
    let suffix = 1;
    while (await tx.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const org = await tx.organization.create({
      data: {
        name: parsed.data.name,
        slug,
        ownerId: user.id,
        settings: { create: {} },
      },
    });

    await createDefaultRoles(org.id, tx);
    const ownerRole = await tx.role.findFirstOrThrow({ where: { organizationId: org.id, key: "OWNER" } });
    await tx.membership.create({ data: { userId: user.id, organizationId: org.id, roleId: ownerRole.id } });

    return org.id;
  });

  const company = await prisma.company.upsert({
    where: { organizationId },
    update: {
      name: parsed.data.name,
      industry: parsed.data.industry,
      website: parsed.data.website || null,
      businessSize: parsed.data.businessSize,
      employeeCount: parsed.data.employeeCount ?? null,
      products: parsed.data.products,
      services: parsed.data.services,
      mission: parsed.data.mission || null,
      vision: parsed.data.vision || null,
      goals: parsed.data.goals,
      targetCustomers: parsed.data.targetCustomers || null,
      competitors: parsed.data.competitors,
      brandVoice: parsed.data.brandVoice || null,
      onboardingCompleted: true,
    },
    create: {
      organizationId,
      name: parsed.data.name,
      industry: parsed.data.industry,
      website: parsed.data.website || null,
      businessSize: parsed.data.businessSize,
      employeeCount: parsed.data.employeeCount ?? null,
      products: parsed.data.products,
      services: parsed.data.services,
      mission: parsed.data.mission || null,
      vision: parsed.data.vision || null,
      goals: parsed.data.goals,
      targetCustomers: parsed.data.targetCustomers || null,
      competitors: parsed.data.competitors,
      brandVoice: parsed.data.brandVoice || null,
      onboardingCompleted: true,
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId,
      actorId: user.id,
      category: "COMPANY",
      action: "company.onboarding_completed",
    },
  });

  return NextResponse.json({ company }, { status: 200 });
}
