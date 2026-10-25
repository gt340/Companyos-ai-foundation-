import { afterEach, describe, expect, it } from "vitest";
import { createActionApprovalToken, verifyActionApprovalToken } from "./action-approval";

const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
const testKey = "test-key-material-01234567890123456789";

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  }
});

describe("assistant action approval tokens", () => {
  it("binds approval to the exact user, organization, tool, arguments, and request", () => {
    process.env.TOKEN_ENCRYPTION_KEY = testKey;
    const input = {
      userId: "user-1",
      organizationId: "org-1",
      tool: "update_profile",
      args: { name: "Approved Name" },
      approvalRequestId: "approval-1",
    };
    const token = createActionApprovalToken(input);

    expect(verifyActionApprovalToken({ token, ...input }).valid).toBe(true);
    expect(verifyActionApprovalToken({ token, ...input }).approvalRequestId).toBe("approval-1");
    expect(verifyActionApprovalToken({ token, ...input, userId: "other-user" }).valid).toBe(false);
    expect(verifyActionApprovalToken({ token, ...input, organizationId: "other-org" }).valid).toBe(false);
    expect(verifyActionApprovalToken({ token, ...input, tool: "send_email" }).valid).toBe(false);
    expect(verifyActionApprovalToken({ token, ...input, args: { name: "Different" } }).valid).toBe(false);
    expect(verifyActionApprovalToken({ token: `${token}.junk`, ...input }).valid).toBe(false);
  });

  it("fails closed when the signing key is missing or too short", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => createActionApprovalToken({
      userId: "user-1",
      organizationId: "org-1",
      tool: "update_profile",
      args: { name: "Approved Name" },
      approvalRequestId: "approval-1",
    })).toThrow(/TOKEN_ENCRYPTION_KEY/);

    process.env.TOKEN_ENCRYPTION_KEY = "too-short";
    expect(() => createActionApprovalToken({
      userId: "user-1",
      organizationId: "org-1",
      tool: "update_profile",
      args: { name: "Approved Name" },
      approvalRequestId: "approval-1",
    })).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});
