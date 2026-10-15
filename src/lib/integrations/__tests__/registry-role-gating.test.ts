import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The registry imports every integration tool module. Mock the modules that
// would touch the database, cookies, or Google so these tests never need a
// database, a session, or a network connection.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/active-org", () => ({
  getActiveOrganizationId: vi.fn(),
  ACTIVE_ORG_COOKIE_NAME: "companyos_active_org",
}));
vi.mock("@/lib/google/token", () => ({ getValidGoogleAccessToken: vi.fn() }));

import { getActiveOrganizationId } from "@/lib/active-org";
import { getValidGoogleAccessToken } from "@/lib/google/token";
import {
  INTEGRATION_TOOL_DEFINITIONS,
  INTEGRATION_TOOL_EXECUTORS,
  INTEGRATION_TOOL_MIN_ROLES,
} from "../registry";

// No test is allowed to reach the network (and so no paid provider).
const fetchMock = vi.fn(() => {
  throw new Error("Unexpected network call in test");
});

beforeEach(() => {
  vi.mocked(getActiveOrganizationId).mockReset().mockResolvedValue(null);
  vi.mocked(getValidGoogleAccessToken).mockReset().mockResolvedValue(null);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const DENIED = /^You don't have permission/;

// Valid sample arguments, so that an allowed role gets past argument checks
// and into the tool itself.
const RESTRICTED_SAMPLE_ARGS: Record<string, unknown> = {
  generate_video: { prompt: "A short product demo" },
  generate_avatar_video: { script: "Hello there", avatarId: "avatar1", voiceId: "voice1" },
  create_zoom_meeting: { topic: "Test meeting", startDateTime: "2026-10-15T14:00:00" },
  delete_zoom_meeting: { meetingId: "123456789" },
  save_avatar_video_to_drive: { videoId: "video12345" },
};

const RESTRICTED_TOOLS = Object.keys(RESTRICTED_SAMPLE_ARGS);

const ALLOWED_ROLES = ["OWNER", "ADMIN"];
const DENIED_ROLES = ["MEMBER", "VIEWER"];

const INVALID_ROLE_VALUES: unknown[] = [
  undefined,
  null,
  "",
  "owner",
  "admin",
  "SUPERADMIN",
  0,
  true,
  {},
  ["OWNER"],
];

function executor(name: string) {
  const fn = INTEGRATION_TOOL_EXECUTORS[name];
  if (!fn) throw new Error(`No executor registered for "${name}"`);
  return fn;
}

async function errorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected the call to fail, but it succeeded");
}

function pairs(roles: string[]): [string, string][] {
  return RESTRICTED_TOOLS.flatMap((tool) => roles.map((role): [string, string] => [tool, role]));
}

describe("restricted tools are enforced through the registry", () => {
  it.each(pairs(ALLOWED_ROLES))("%s: %s passes the role check and reaches the tool", async (tool, role) => {
    const ctx = { userId: "user-1", role };
    const error = await errorOf(executor(tool)(RESTRICTED_SAMPLE_ARGS[tool], ctx));

    // The tool body ran (it stopped only because no company could be resolved).
    expect(error.message).toMatch(/Could not tell which company/);
    expect(error.message).not.toMatch(/permission/);
    expect(getActiveOrganizationId).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(pairs(DENIED_ROLES))("%s: %s is denied before the tool runs", async (tool, role) => {
    const ctx = { userId: "user-1", role };
    const error = await errorOf(executor(tool)(RESTRICTED_SAMPLE_ARGS[tool], ctx));

    expect(error.message).toMatch(DENIED);
    expect(getActiveOrganizationId).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(RESTRICTED_TOOLS)("%s fails closed for a missing or invalid role", async (tool) => {
    for (const role of INVALID_ROLE_VALUES) {
      const ctx = { userId: "user-1", role };
      const error = await errorOf(executor(tool)(RESTRICTED_SAMPLE_ARGS[tool], ctx));
      expect(error.message, `role ${JSON.stringify(role)}`).toMatch(DENIED);
    }

    const missingContext = undefined as unknown as { userId: string };
    const error = await errorOf(executor(tool)(RESTRICTED_SAMPLE_ARGS[tool], missingContext));
    expect(error.message).toMatch(DENIED);

    expect(getActiveOrganizationId).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("other integration tools keep their existing permissions", () => {
  const OPEN_TOOL_CASES: [string, unknown][] = [
    ["list_zoom_meetings", {}],
    ["get_video_budget", {}],
    ["check_video_status", { jobId: "models/veo-3.1-fast-generate-preview/operations/abc123" }],
    ["list_presenter_avatars", {}],
    ["list_presenter_voices", {}],
    ["check_avatar_video", { videoId: "video12345" }],
    ["get_avatar_budget", {}],
    [
      "create_google_meet",
      {
        summary: "Team sync",
        startDateTime: "2026-10-15T14:00:00",
        endDateTime: "2026-10-15T15:00:00",
      },
    ],
    ["list_drive_files", {}],
  ];

  it.each(OPEN_TOOL_CASES)("%s still runs for a VIEWER", async (tool, args) => {
    const ctx = { userId: "user-1", role: "VIEWER" };
    const error = await errorOf(executor(tool)(args, ctx));

    expect(error.message).not.toMatch(/permission/);

    // The tool body ran: it asked for the company or for Google access.
    const touched =
      vi.mocked(getActiveOrganizationId).mock.calls.length +
      vi.mocked(getValidGoogleAccessToken).mock.calls.length;
    expect(touched).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("registry consistency", () => {
  it("restricts exactly the five approved tools", () => {
    expect(Object.keys(INTEGRATION_TOOL_MIN_ROLES).sort()).toEqual([...RESTRICTED_TOOLS].sort());
  });

  it("only lists tools that are actually registered (no typos)", () => {
    const definitionNames = INTEGRATION_TOOL_DEFINITIONS.map((definition) => definition.name);
    for (const tool of Object.keys(INTEGRATION_TOOL_MIN_ROLES)) {
      expect(INTEGRATION_TOOL_EXECUTORS[tool], `${tool} has an executor`).toBeTypeOf("function");
      expect(definitionNames, `${tool} has a definition`).toContain(tool);
    }
  });
});

describe("existing authorization boundaries are untouched", () => {
  function readSource(relativePath: string): string {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  }

  const toolExecutors = readSource("../../assistant/tool-executors.ts");
  const googleTools = readSource("../../google/gmail-calendar-tools.ts");

  it("generate_image and edit_image remain Owner/Admin only", () => {
    expect(toolExecutors).toMatch(/generate_image:\s*\["OWNER",\s*"ADMIN"\]/);
    expect(toolExecutors).toMatch(/edit_image:\s*\["OWNER",\s*"ADMIN"\]/);
  });

  it("executeTool still checks permission before running any tool", () => {
    expect(toolExecutors).toMatch(/assertPermission\(toolName, ctx\);\s*return fn\(args, ctx\);/);
  });

  it("integration tools still reach the dispatcher only through the role-wrapped executors", () => {
    expect(toolExecutors).toMatch(/\.\.\.GOOGLE_TOOL_EXECUTORS/);
    expect(googleTools).toMatch(/\.\.\.INTEGRATION_TOOL_EXECUTORS/);
  });
});
