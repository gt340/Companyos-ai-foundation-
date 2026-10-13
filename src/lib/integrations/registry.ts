// src/lib/integrations/registry.ts
// One place that gathers every external-integration tool module (Google
// Drive, YouTube + video + upload + live streaming, AdSense, meetings, AI
// presenter videos, ...). To add a new integration: create its tool module,
// then add its definitions, executors, and (if any) mutating tool names here.
// tools.ts and gmail-calendar-tools.ts only import from this file, so they do
// not need to change again.
//
// This file imports the tool modules; none of them import it back, and they
// only import the AssistantTool TYPE from tools.ts (erased at compile time),
// so there is no circular import.
//
// Every executor is wrapped with the role check from role-gating.ts, so
// restricted tools (see INTEGRATION_TOOL_MIN_ROLES) are enforced on every
// execution path. Tools without an entry there behave exactly as before.

import type { AssistantTool } from "../assistant/tools";
import {
  AVATAR_MUTATING_TOOL_NAMES,
  AVATAR_TOOL_DEFINITIONS,
  AVATAR_TOOL_EXECUTORS,
} from "../avatar/heygen-tools";
import { ADSENSE_TOOL_DEFINITIONS, ADSENSE_TOOL_EXECUTORS } from "../google/adsense-tools";
import { DRIVE_TOOL_DEFINITIONS, DRIVE_TOOL_EXECUTORS } from "../google/drive-tools";
import {
  LIVE_MUTATING_TOOL_NAMES,
  LIVE_TOOL_DEFINITIONS,
  LIVE_TOOL_EXECUTORS,
} from "../google/youtube-live";
import { YOUTUBE_TOOL_DEFINITIONS, YOUTUBE_TOOL_EXECUTORS } from "../google/youtube-tools";
import { UPLOAD_TOOL_NAMES } from "../google/youtube-upload";
import {
  MEETING_MUTATING_TOOL_NAMES,
  MEETING_TOOL_DEFINITIONS,
  MEETING_TOOL_EXECUTORS,
} from "../meetings/meeting-tools";
import { withRoleCheck } from "./role-gating";

export { INTEGRATION_TOOL_MIN_ROLES } from "./role-gating";

interface MinimalCtx {
  userId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IntegrationExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const INTEGRATION_TOOL_DEFINITIONS: AssistantTool[] = [
  ...DRIVE_TOOL_DEFINITIONS,
  ...YOUTUBE_TOOL_DEFINITIONS, // includes the Veo video tools and upload_youtube_video
  ...LIVE_TOOL_DEFINITIONS,
  ...ADSENSE_TOOL_DEFINITIONS,
  ...MEETING_TOOL_DEFINITIONS,
  ...AVATAR_TOOL_DEFINITIONS,
];

const RAW_INTEGRATION_TOOL_EXECUTORS: Record<string, IntegrationExecutorFn> = {
  ...DRIVE_TOOL_EXECUTORS,
  ...YOUTUBE_TOOL_EXECUTORS, // includes the Veo video tools and upload_youtube_video
  ...LIVE_TOOL_EXECUTORS,
  ...ADSENSE_TOOL_EXECUTORS,
  ...MEETING_TOOL_EXECUTORS,
  ...AVATAR_TOOL_EXECUTORS,
};

export const INTEGRATION_TOOL_EXECUTORS: Record<string, IntegrationExecutorFn> =
  Object.fromEntries(
    Object.entries(RAW_INTEGRATION_TOOL_EXECUTORS).map(([name, executor]) => [
      name,
      withRoleCheck(name, executor),
    ])
  );

// Tools with real external effects: these always go through the Confirm card.
export const INTEGRATION_MUTATING_TOOL_NAMES: string[] = [
  ...UPLOAD_TOOL_NAMES,
  ...LIVE_MUTATING_TOOL_NAMES,
  ...MEETING_MUTATING_TOOL_NAMES,
  ...AVATAR_MUTATING_TOOL_NAMES,
];
