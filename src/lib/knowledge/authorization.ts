/** Roles permitted to mutate organization knowledge-base documents. */
export function canManageKnowledgeBase(role: unknown): boolean {
  return role === "OWNER" || role === "ADMIN";
}
