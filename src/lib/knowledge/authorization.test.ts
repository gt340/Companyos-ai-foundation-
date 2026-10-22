import { describe, expect, it } from "vitest";
import { canManageKnowledgeBase } from "./authorization";

describe("canManageKnowledgeBase", () => {
  it.each(["OWNER", "ADMIN"])("allows %s", (role) => {
    expect(canManageKnowledgeBase(role)).toBe(true);
  });

  it.each(["MEMBER", "VIEWER", "owner", "admin", "", null, undefined, 1, {}, []])(
    "denies invalid or non-manager role %s",
    (role) => {
      expect(canManageKnowledgeBase(role)).toBe(false);
    },
  );
});
