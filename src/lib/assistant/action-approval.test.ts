import { describe, expect, it } from "vitest";
import { createActionApprovalToken, verifyActionApprovalToken } from "./action-approval";

describe("assistant action approval tokens", () => {
  it("binds approval to the exact user, organization, tool, and arguments", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-key-material-01234567890123456789";
    const input = {
      userId: "user-1",
      organizationId: "org-1",
      tool: "update_profile",
      args: { name: "Approved Name" },
    };
    const token = createActionApprovalToken(input);
    expect(verifyActionApprovalToken({ token, ...input }).valid).toBe(true);
    expect(verifyActionApprovalToken({ token, ...input, userId: "other-user" }).valid).toBe(false);
    expect(verifyActionApprovalToken({ token, ...input, args: { name: "Different" } }).valid).toBe(false);
  });
});
