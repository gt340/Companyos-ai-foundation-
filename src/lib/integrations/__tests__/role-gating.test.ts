import { describe, expect, it, vi } from "vitest";
import {
  INTEGRATION_TOOL_MIN_ROLES,
  assertIntegrationRole,
  permissionDeniedMessage,
  withRoleCheck,
} from "../role-gating";

// The five tools approved for Owner/Admin-only access in Phase 1.
const RESTRICTED_TOOLS = [
  "generate_video",
  "generate_avatar_video",
  "create_zoom_meeting",
  "delete_zoom_meeting",
  "save_avatar_video_to_drive",
] as const;

// Tools whose permissions must NOT change: read-only and status tools, and the
// personal Google tools. An unknown tool name is also unrestricted here.
const UNRESTRICTED_TOOLS = [
  "list_zoom_meetings",
  "get_video_budget",
  "check_video_status",
  "list_presenter_avatars",
  "list_presenter_voices",
  "check_avatar_video",
  "get_avatar_budget",
  "create_google_meet",
  "upload_youtube_video",
  "list_drive_files",
  "read_drive_file",
  "get_youtube_channel",
  "some_unknown_tool",
];

const ALLOWED_ROLES = ["OWNER", "ADMIN"];
const DENIED_ROLES = ["MEMBER", "VIEWER"];

// Anything that is not exactly the string "OWNER" or "ADMIN" must be denied.
const INVALID_ROLE_VALUES: unknown[] = [
  undefined,
  null,
  "",
  " ",
  "owner",
  "admin",
  "Owner",
  "OWNER ",
  " ADMIN",
  "SUPERADMIN",
  "ROOT",
  0,
  1,
  true,
  false,
  {},
  [],
  ["OWNER"],
  { key: "OWNER" },
];

const INVALID_CONTEXTS: unknown[] = [undefined, null, "OWNER", 42, {}, { userId: "u1" }, []];

const DENIED = /^You don't have permission/;

describe("restricted tool list", () => {
  it("restricts exactly the five approved tools and nothing else", () => {
    expect(Object.keys(INTEGRATION_TOOL_MIN_ROLES).sort()).toEqual([...RESTRICTED_TOOLS].sort());
  });

  it.each(RESTRICTED_TOOLS)("%s is limited to OWNER and ADMIN", (tool) => {
    expect([...(INTEGRATION_TOOL_MIN_ROLES[tool] ?? [])].sort()).toEqual(["ADMIN", "OWNER"]);
  });
});

describe("assertIntegrationRole", () => {
  describe.each(RESTRICTED_TOOLS)("%s", (tool) => {
    it.each(ALLOWED_ROLES)("allows %s", (role) => {
      expect(() => assertIntegrationRole(tool, { role })).not.toThrow();
    });

    it.each(DENIED_ROLES)("denies %s", (role) => {
      expect(() => assertIntegrationRole(tool, { role })).toThrow(DENIED);
    });

    it("fails closed for every missing or invalid role value", () => {
      for (const role of INVALID_ROLE_VALUES) {
        expect(
          () => assertIntegrationRole(tool, { role }),
          `role ${JSON.stringify(role)} should be denied`
        ).toThrow(DENIED);
      }
    });

    it("fails closed for every missing or invalid context", () => {
      for (const ctx of INVALID_CONTEXTS) {
        expect(
          () => assertIntegrationRole(tool, ctx),
          `context ${JSON.stringify(ctx)} should be denied`
        ).toThrow(DENIED);
      }
    });
  });

  it.each(UNRESTRICTED_TOOLS)("does not restrict %s (permissions unchanged)", (tool) => {
    for (const role of [...ALLOWED_ROLES, ...DENIED_ROLES]) {
      expect(() => assertIntegrationRole(tool, { role })).not.toThrow();
    }
    expect(() => assertIntegrationRole(tool, undefined)).not.toThrow();
  });
});

describe("permissionDeniedMessage", () => {
  it("starts with the prefix the confirm route maps to HTTP 403", () => {
    expect(permissionDeniedMessage("VIEWER")).toMatch(DENIED);
  });

  it("names a known role", () => {
    expect(permissionDeniedMessage("VIEWER")).toContain("your role is VIEWER");
    expect(permissionDeniedMessage("MEMBER")).toContain("your role is MEMBER");
  });

  it("never echoes unknown or invalid role text", () => {
    const message = permissionDeniedMessage("<script>alert(1)</script>");
    expect(message).toContain("your role is unknown");
    expect(message).not.toContain("script");
    expect(permissionDeniedMessage(undefined)).toContain("your role is unknown");
    expect(permissionDeniedMessage(123)).toContain("your role is unknown");
  });
});

describe("withRoleCheck", () => {
  it("runs a restricted tool for OWNER and ADMIN and passes arguments through", async () => {
    for (const role of ALLOWED_ROLES) {
      const executor = vi.fn(async (args: { n: number }, _ctx: unknown) => args.n * 2);
      const wrapped = withRoleCheck("create_zoom_meeting", executor);
      const ctx = { userId: "u1", role };

      await expect(wrapped({ n: 21 }, ctx)).resolves.toBe(42);
      expect(executor).toHaveBeenCalledTimes(1);
      expect(executor).toHaveBeenCalledWith({ n: 21 }, ctx);
    }
  });

  it("never runs a restricted tool for MEMBER or VIEWER", async () => {
    for (const tool of RESTRICTED_TOOLS) {
      for (const role of DENIED_ROLES) {
        const executor = vi.fn(async (_args: unknown, _ctx: unknown) => "ran");
        const wrapped = withRoleCheck(tool, executor);

        await expect(wrapped({}, { userId: "u1", role })).rejects.toThrow(DENIED);
        expect(executor).not.toHaveBeenCalled();
      }
    }
  });

  it("never runs a restricted tool when the role or context is missing or invalid", async () => {
    for (const ctx of INVALID_CONTEXTS) {
      const executor = vi.fn(async (_args: unknown, _ctx: unknown) => "ran");
      const wrapped = withRoleCheck("generate_video", executor);

      await expect(wrapped({}, ctx)).rejects.toThrow(DENIED);
      expect(executor).not.toHaveBeenCalled();
    }
    for (const role of INVALID_ROLE_VALUES) {
      const executor = vi.fn(async (_args: unknown, _ctx: unknown) => "ran");
      const wrapped = withRoleCheck("generate_avatar_video", executor);

      await expect(wrapped({}, { userId: "u1", role })).rejects.toThrow(DENIED);
      expect(executor).not.toHaveBeenCalled();
    }
  });

  it("still runs an unrestricted tool for every role, including VIEWER", async () => {
    for (const role of [...ALLOWED_ROLES, ...DENIED_ROLES]) {
      const executor = vi.fn(async (_args: unknown, _ctx: unknown) => "ran");
      const wrapped = withRoleCheck("list_zoom_meetings", executor);

      await expect(wrapped({}, { userId: "u1", role })).resolves.toBe("ran");
      expect(executor).toHaveBeenCalledTimes(1);
    }
  });
});
