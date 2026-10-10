// src/lib/integrations/registry.ts
// One place that gathers every external-integration tool module (Google
// Drive, YouTube + video + upload, meetings, ...). To add a new integration:
// create its tool module, then add its definitions, executors, and (if any)
// mutating tool names here. tools.ts and gmail-calendar-tools.ts only import
// from this file, so they do not need to change again.
//
// This file imports the tool modules; none of them import it back, and they
// only import the AssistantTool TYPE from tools.ts (erased at compile time),
// so there is no circular import.

import type { AssistantTool } from "../assistant/tools";
import { DRIVE_TOOL_DEFINITIONS, DRIVE_TOOL_EXECUTORS } from "../google/drive-tools";
import { YOUTUBE_TOOL_DEFINITIONS, YOUTUBE_TOOL_EXECUTORS } from "../google/youtube-tools";
import { UPLOAD_TOOL_NAMES } from "../google/youtube-upload";
import {
  MEETING_MUTATING_TOOL_NAMES,
  MEETING_TOOL_DEFINITIONS,
  MEETING_TOOL_EXECUTORS,
} from "../meetings/meeting-tools";

interface MinimalCtx {
  userId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IntegrationExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const INTEGRATION_TOOL_DEFINITIONS: AssistantTool[] = [
  ...DRIVE_TOOL_DEFINITIONS,
  ...YOUTUBE_TOOL_DEFINITIONS, // includes the Veo video tools and upload_youtube_video
  ...MEETING_TOOL_DEFINITIONS,
];

export const INTEGRATION_TOOL_EXECUTORS: Record<string, IntegrationExecutorFn> = {
  ...DRIVE_TOOL_EXECUTORS,
  ...YOUTUBE_TOOL_EXECUTORS, // includes the Veo video tools and upload_youtube_video
  ...MEETING_TOOL_EXECUTORS,
};

// Tools with real external effects: these always go through the Confirm card.
export const INTEGRATION_MUTATING_TOOL_NAMES: string[] = [
  ...UPLOAD_TOOL_NAMES,
  ...MEETING_MUTATING_TOOL_NAMES,
];
