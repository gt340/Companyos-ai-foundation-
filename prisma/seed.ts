/**
 * Seeds the global permission catalog used by RBAC.
 * Organization-scoped Roles are created at organization-creation time
 * (see src/lib/rbac.ts -> createDefaultRoles) and attached to these
 * permissions by key, so this list is the single source of truth.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PERMISSIONS: { key: string; description: string }[] = [
  { key: "organization.manage", description: "Manage organization profile and settings" },
  { key: "organization.delete", description: "Delete the organization" },
  { key: "company.edit", description: "Edit company profile and onboarding data" },
  { key: "team.manage", description: "Create, rename, and delete teams" },
  { key: "member.invite", description: "Invite new members to the organization" },
  { key: "member.remove", description: "Remove members from the organization" },
  { key: "role.assign", description: "Change a member's role" },
  { key: "billing.manage", description: "View and manage billing and subscription" },
  { key: "activity.view", description: "View activity logs" },
  { key: "notifications.manage", description: "Manage organization notification preferences" },
];

async function main() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
