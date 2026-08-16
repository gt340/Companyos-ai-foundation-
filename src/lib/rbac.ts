import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, RoleKey } from "@prisma/client";

/**
 * Central permission catalog attached to each system role at
 * organization-creation time. Keep in sync with prisma/seed.ts.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, string[]> = {
  OWNER: [
    "organization.manage",
    "organization.delete",
    "company.edit",
    "team.manage",
    "member.invite",
    "member.remove",
    "role.assign",
    "billing.manage",
    "activity.view",
    "notifications.manage",
  ],
  ADMIN: [
    "organization.manage",
    "company.edit",
    "team.manage",
    "member.invite",
    "member.remove",
    "role.assign",
    "activity.view",
    "notifications.manage",
  ],
  MEMBER: ["company.edit", "activity.view"],
  VIEWER: ["activity.view"],
};

/**
 * Creates the four system roles (Owner/Admin/Member/Viewer) for a
 * newly created organization and wires each to its permission set.
 * Run inside the same transaction as organization creation.
 */
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export async function createDefaultRoles(organizationId: string, client: PrismaClientOrTx = prisma) {
  const roleKeys = Object.keys(ROLE_PERMISSIONS) as RoleKey[];
  const permissions = await client.permission.findMany();
  const permissionByKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const key of roleKeys) {
    const role = await client.role.create({
      data: {
        organizationId,
        key,
        name: key.charAt(0) + key.slice(1).toLowerCase(),
        isSystem: true,
      },
    });

    const permissionIds = ROLE_PERMISSIONS[key]
      .map((permKey) => permissionByKey.get(permKey))
      .filter((id): id is string => Boolean(id));

    if (permissionIds.length > 0) {
      await client.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
  }
}

/** Returns true if the membership's role grants the given permission key. */
export async function hasPermission(membershipId: string, permissionKey: string): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!membership || !membership.isActive) return false;
  return membership.role.permissions.some((rp) => rp.permission.key === permissionKey);
}

/** Loads the active membership (with role + permissions) for a user in an org, or null. */
export async function getMembership(userId: string, organizationId: string) {
  return prisma.membership.findFirst({
    where: { userId, organizationId, isActive: true },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
/**
 * Resolves the user's primary organization membership — the first
 * active one, ordered by join date. Multi-organization switching
 * isn't built yet, so every "current workspace" route relies on this
 * until a workspace-selection mechanism exists.
 */
export async function getPrimaryMembership(userId: string) {
  return prisma.membership.findFirst({
    where: { userId, isActive: true },
    orderBy: { joinedAt: "asc" },
    include: {
      organization: { include: { settings: true } },
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
                                    }
  
}
