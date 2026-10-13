// src/lib/integrations/role-gating.ts
// Role-based authorization for company-level integration tools.
//
// Spend-incurring tools (AI video and presenter generation) and company-level
// Zoom actions are limited to company OWNERS and ADMINS, matching the existing
// restriction on generate_image / edit_image. Tools that are not listed here
// keep their previous behavior (open to every role); the personal Google tools
// and the read-only tools are deliberately not listed.
//
// The check runs inside the executor, so it applies on EVERY execution path:
// the chat route (inline, read-only tools) and the confirm route (mutating
// tools) both go through executeTool, which calls these executors.
//
// It FAILS CLOSED: a missing, empty, non-string, unknown or wrongly-cased role
// is denied. Only the exact strings "OWNER" and "ADMIN" pass.
//
// This module has no heavy imports on purpose, so it can be unit tested on its
// own. The role type is imported as a TYPE only (erased at compile time).

import type { RoleKey } from "@prisma/client";

const ALLOWED_OWNER_ADMIN: readonly RoleKey[] = ["OWNER", "ADMIN"];

// Tool name -> roles allowed to run it. Add a tool here to restrict it.
export const INTEGRATION_TOOL_MIN_ROLES: Readonly<Record<string, readonly RoleKey[]>> = {
  generate_video: ALLOWED_OWNER_ADMIN,
  generate_avatar_video: ALLOWED_OWNER_ADMIN,
  create_zoom_meeting: ALLOWED_OWNER_ADMIN,
  delete_zoom_meeting: ALLOWED_OWNER_ADMIN,
  save_avatar_video_to_drive: ALLOWED_OWNER_ADMIN,
};

const KNOWN_ROLES: readonly string[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

// The message deliberately starts with "You don't have permission" because the
// confirm route maps errors with that prefix to an HTTP 403.
export function permissionDeniedMessage(role: unknown): string {
  const shown = typeof role === "string" && KNOWN_ROLES.includes(role) ? role : "unknown";
  return `You don't have permission to approve this action. Only the Owner or Admins can do this — your role is ${shown}.`;
}

// Throws when the tool is restricted and the context's role is not allowed.
// Tools with no entry in INTEGRATION_TOOL_MIN_ROLES are not restricted here.
export function assertIntegrationRole(toolName: string, ctx: unknown): void {
  const allowed = INTEGRATION_TOOL_MIN_ROLES[toolName];
  if (!allowed) return;

  const role =
    ctx !== null && typeof ctx === "object" ? (ctx as { role?: unknown }).role : undefined;

  if (typeof role !== "string" || !allowed.includes(role as RoleKey)) {
    throw new Error(permissionDeniedMessage(role));
  }
}

// Wraps an executor so the role check always runs before the tool itself.
export function withRoleCheck<TArgs, TCtx, TResult>(
  toolName: string,
  executor: (args: TArgs, ctx: TCtx) => Promise<TResult>
): (args: TArgs, ctx: TCtx) => Promise<TResult> {
  return async (args, ctx) => {
    assertIntegrationRole(toolName, ctx);
    return executor(args, ctx);
  };
}
