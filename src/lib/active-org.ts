import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const ACTIVE_ORG_COOKIE = "companyos_active_org";

/**
 * Resolves which organization the current request should operate on.
 * Falls back to the user's first active membership if no cookie is set
 * yet, or if the cookied org is no longer one they belong to.
 */
export async function getActiveOrganizationId(userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  const cookied = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  if (cookied) {
    const membership = await prisma.membership.findFirst({
      where: { userId, organizationId: cookied, isActive: true },
      select: { organizationId: true },
    });
    if (membership) return membership.organizationId;
  }

  const firstMembership = await prisma.membership.findFirst({
    where: { userId, isActive: true },
    orderBy: { joinedAt: "asc" },
    select: { organizationId: true },
  });

  return firstMembership?.organizationId ?? null;
}

export const ACTIVE_ORG_COOKIE_NAME = ACTIVE_ORG_COOKIE;
