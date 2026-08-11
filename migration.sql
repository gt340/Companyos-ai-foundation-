-- This migration mirrors the schema already applied directly to the
-- live Supabase project (sjdipwiazrsmexnffjba) via the Supabase MCP
-- connector on 2026-08-11. It exists so Prisma's local migration
-- history matches reality — once DATABASE_URL is set locally, run:
--
--   npx prisma migrate resolve --applied 20260811000000_init
--
-- to mark it as applied without Prisma trying to re-run it.

-- Enums
CREATE TYPE "RoleKey" AS ENUM ('OWNER','ADMIN','MEMBER','VIEWER');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING','ACCEPTED','DECLINED','EXPIRED','REVOKED');
CREATE TYPE "BusinessSize" AS ENUM ('SOLO','MICRO','SMALL','MEDIUM','LARGE','ENTERPRISE');
CREATE TYPE "ActivityCategory" AS ENUM ('AUTH','ORGANIZATION','COMPANY','TEAM','MEMBER','BILLING','SETTINGS','SECURITY','SYSTEM');
CREATE TYPE "NotificationType" AS ENUM ('INFO','SUCCESS','WARNING','ERROR','INVITATION','BILLING','SYSTEM');

-- users (id mirrors auth.users.id — no default, app sets it explicitly)
CREATE TABLE "users" (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  "fullName" text,
  "avatarUrl" text,
  "jobTitle" text,
  phone text,
  timezone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en',
  "emailVerified" boolean NOT NULL DEFAULT false,
  "lastLoginAt" timestamptz,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- organizations
CREATE TABLE "organizations" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  "logoUrl" text,
  "ownerId" uuid NOT NULL REFERENCES "users"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "organizations_ownerId_idx" ON "organizations"("ownerId");

-- organization_settings
CREATE TABLE "organization_settings" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid UNIQUE NOT NULL REFERENCES "organizations"(id) ON DELETE CASCADE,
  "brandVoice" text,
  "defaultTimezone" text NOT NULL DEFAULT 'UTC',
  "allowPublicSignup" boolean NOT NULL DEFAULT false,
  "requireTwoFactor" boolean NOT NULL DEFAULT false,
  "notifyOnNewMember" boolean NOT NULL DEFAULT true,
  "notifyOnBillingEvents" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- companies
CREATE TABLE "companies" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid UNIQUE NOT NULL REFERENCES "organizations"(id) ON DELETE CASCADE,
  name text NOT NULL,
  industry text NOT NULL,
  website text,
  "businessSize" "BusinessSize" NOT NULL,
  mission text,
  vision text,
  goals text[] NOT NULL DEFAULT '{}',
  products text[] NOT NULL DEFAULT '{}',
  services text[] NOT NULL DEFAULT '{}',
  "targetCustomers" text,
  competitors text[] NOT NULL DEFAULT '{}',
  "brandVoice" text,
  "employeeCount" integer,
  "onboardingStep" integer NOT NULL DEFAULT 0,
  "onboardingCompleted" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- company_documents
CREATE TABLE "company_documents" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL REFERENCES "companies"(id) ON DELETE CASCADE,
  "fileName" text NOT NULL,
  "fileUrl" text NOT NULL,
  "fileType" text NOT NULL,
  "fileSizeKb" integer NOT NULL,
  "uploadedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "company_documents_companyId_idx" ON "company_documents"("companyId");

-- teams
CREATE TABLE "teams" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "organizations"(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "teams_organizationId_idx" ON "teams"("organizationId");

-- roles
CREATE TABLE "roles" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "organizations"(id) ON DELETE CASCADE,
  key "RoleKey" NOT NULL,
  name text NOT NULL,
  description text,
  "isSystem" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organizationId", key)
);

-- permissions
CREATE TABLE "permissions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  description text NOT NULL
);

-- role_permissions
CREATE TABLE "role_permissions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roleId" uuid NOT NULL REFERENCES "roles"(id) ON DELETE CASCADE,
  "permissionId" uuid NOT NULL REFERENCES "permissions"(id) ON DELETE CASCADE,
  UNIQUE ("roleId", "permissionId")
);

-- memberships
CREATE TABLE "memberships" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES "organizations"(id) ON DELETE CASCADE,
  "roleId" uuid NOT NULL REFERENCES "roles"(id),
  "isActive" boolean NOT NULL DEFAULT true,
  "joinedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "organizationId")
);
CREATE INDEX "memberships_organizationId_idx" ON "memberships"("organizationId");

-- team_members
CREATE TABLE "team_members" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "teamId" uuid NOT NULL REFERENCES "teams"(id) ON DELETE CASCADE,
  "membershipId" uuid NOT NULL REFERENCES "memberships"(id) ON DELETE CASCADE,
  "joinedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("teamId", "membershipId")
);

-- invitations
CREATE TABLE "invitations" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "organizations"(id) ON DELETE CASCADE,
  email text NOT NULL,
  "roleKey" "RoleKey" NOT NULL DEFAULT 'MEMBER',
  status "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  token text UNIQUE NOT NULL,
  "invitedById" uuid NOT NULL REFERENCES "users"(id),
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "invitations_organizationId_idx" ON "invitations"("organizationId");
CREATE INDEX "invitations_email_idx" ON "invitations"(email);

-- activity_logs
CREATE TABLE "activity_logs" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "organizations"(id) ON DELETE CASCADE,
  "actorId" uuid REFERENCES "users"(id),
  category "ActivityCategory" NOT NULL,
  action text NOT NULL,
  metadata jsonb,
  "ipAddress" text,
  "userAgent" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "activity_logs_organizationId_createdAt_idx" ON "activity_logs"("organizationId", "createdAt");
CREATE INDEX "activity_logs_actorId_idx" ON "activity_logs"("actorId");

-- notifications
CREATE TABLE "notifications" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "organizations"(id) ON DELETE CASCADE,
  "userId" uuid NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
  type "NotificationType" NOT NULL DEFAULT 'INFO',
  title text NOT NULL,
  message text NOT NULL,
  "isRead" boolean NOT NULL DEFAULT false,
  "actionUrl" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- Lock every table out of the PostgREST/anon API surface. The app
-- talks to Postgres directly via Prisma (table owner), never through
-- supabase-js against these tables, so RLS with no policies is the
-- correct default here rather than writing per-table policies.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
