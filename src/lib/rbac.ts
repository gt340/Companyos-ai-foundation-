import "server-only";
import { prisma } from "@/lib/prisma";
import type { RoleKey } from "@prisma/client";

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
export async function createDefaultRoles(organizationId: string) {
  const roleKeys = Object.keys(ROLE_PERMISSIONS) as RoleKey[];
  const permissions = await prisma.permission.findMany();
  const permissionByKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const key of roleKeys) {
    const role = await prisma.role.create({
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
      await prisma.rolePermission.createMany({
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
}
