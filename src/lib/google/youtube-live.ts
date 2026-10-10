// src/lib/google/youtube-live.ts
// YouTube live streaming tools (YouTube Live Streaming API, part of the
// YouTube Data API v3): schedule a live broadcast, get the RTMP stream
// address/key to put into an encoder (OBS, a cloud server, ...), check whether
// the encoder is sending, list broadcasts, and move a broadcast to
// testing/live/complete.
//
// IMPORTANT: this does not stream any video itself. Someone (or a separate
// always-on server) must send live video to the stream address with the
// stream key. With auto-start on (the default here), the broadcast goes live
// by itself when the encoder starts sending, and ends when it stops.
//
// Requirements:
//  - YouTube Data API v3 enabled in the Google Cloud project.
//  - Live streaming enabled on the YouTube channel (YouTube verifies the
//    channel; the first activation can take up to 24 hours).
//  - The connected Google account must have granted the full "youtube" scope
//    (requested by /api/auth/google/connect; accounts connected before that
//    scope was added must disconnect and reconnect).
//  - Quota: creating/binding/transitioning cost about 50 units each.
//
// Creating a broadcast and changing its state are public-facing actions, so
// those tools are MUTATING and always show a Confirm card first.
//
// Registered through src/lib/integrations/registry.ts. The AssistantTool
// import is type-only, so there is no circular import with tools.ts.

import type { AssistantTool } from "../assistant/tools";
import { prisma } from "@/lib/prisma";
import { getValidGoogleAccessToken } from "./token";

interface MinimalCtx {
  userId: string;
}

// Loosely-typed Google API JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const YT_API = "https://www.googleapis.com/youtube/v3";
const SCOPE_YOUTUBE = "https://www.googleapis.com/auth/youtube";

const NOT_CONNECTED =
  "No Google account is connected yet. Connect one at /integrations before using YouTube live streaming.";

async function requireLiveToken(userId: string): Promise<string> {
  const connection = await prisma.googleConnection.findUnique({
    where: { userId },
    select: { scopes: true },
  });
  if (!connection) throw new Error(NOT_CONNECTED);

  if (!connection.scopes.includes(SCOPE_YOUTUBE)) {
    throw new Error(
      "Your connected Google account has not granted YouTube live streaming permission yet. Disconnect and reconnect your Google account at /integrations, and approve the YouTube permissions on the Google screen."
    );
  }

  const token = await getValidGoogleAccessToken(userId);
  if (!token) throw new Error(NOT_CONNECTED);
  return token;
}

async function liveError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  let reason = "";
  try {
    const data = await res.json();
    message = data?.error?.message ?? fallback;
    reason = data?.error?.errors?.[0]?.reason ?? "";
  } catch {
    // response body was not JSON - keep the fallback message
  }

  if (/liveStreamingNotEnabled/i.test(reason) || /not enabled for live streaming/i.test(message)) {
    message +=
      " (Live streaming is not enabled on this YouTube channel yet. Turn it on in YouTube Studio under Create, then Go live. Verification can take up to 24 hours.)";
  } else if (res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(message)) {
    message +=
      " (Enable the YouTube Data API v3 in the Google Cloud project: APIs & Services, Library.)";
  } else if (res.status === 403 && /quota/i.test(message)) {
    message += " (The daily YouTube API quota may be used up; it resets daily.)";
  } else if (res.status === 403 && /insufficient/i.test(message)) {
    message +=
      " (Disconnect and reconnect Google at /integrations to grant the YouTube permissions.)";
  }
  return new Error(message);
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string): Record<string, string> {
  return { ...authHeaders(token), "Content-Type": "application/json" };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

// -- STREAM (the RTMP connection details) --------------------------------

interface StreamSummary {
  streamId: string;
  title: string | null;
  ingestionAddress: string | null;
  rtmpsAddress: string | null;
  streamKey: string; // secret - only returned to the user when explicitly asked
  streamStatus: string | null;
  health: string | null;
  isReusable: boolean;
}

function summarizeStream(s: Json): StreamSummary {
  return {
    streamId: s.id,
    title: s.snippet?.title ?? null,
    ingestionAddress: s.cdn?.ingestionInfo?.ingestionAddress ?? null,
    rtmpsAddress: s.cdn?.ingestionInfo?.rtmpsIngestionAddress ?? null,
    streamKey: s.cdn?.ingestionInfo?.streamName ?? "",
    streamStatus: s.status?.streamStatus ?? null,
    health: s.status?.healthStatus?.status ?? null,
    isReusable: Boolean(s.contentDetails?.isReusable),
  };
}

async function listStreams(token: string): Promise<StreamSummary[]> {
  const params = new URLSearchParams({
    part: "snippet,cdn,status,contentDetails",
    mine: "true",
    maxResults: "25",
  });
  const res = await fetch(`${YT_API}/liveStreams?${params.toString()}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw await liveError(res, "Failed to load the live stream settings.");
  const data: Json = await res.json();
  return (data.items ?? []).map(summarizeStream);
}

// Reuses the channel's existing reusable RTMP stream if there is one, so the
// stream key stays the same from one broadcast to the next. Creates one if not.
async function getOrCreateStream(token: string, title: string): Promise<StreamSummary> {
  const existing = (await listStreams(token)).find((s) => s.isReusable && s.streamKey);
  if (existing) return existing;

  const res = await fetch(`${YT_API}/liveStreams?part=snippet,cdn,contentDetails,status`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      snippet: { title: `${title} stream`.slice(0, 100) },
      cdn: { frameRate: "variable", ingestionType: "rtmp", resolution: "variable" },
      contentDetails: { isReusable: true },
    }),
  });
  if (!res.ok) throw await liveError(res, "Failed to create the live stream connection.");
  return summarizeStream(await res.json());
}

// -- CREATE A BROADCAST --------------------------------------------------

const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

async function createBroadcast(
  args: {
    title: string;
    description?: string;
    scheduledStartTime?: string;
    privacy?: string;
    madeForKids?: boolean;
    latency?: string;
  },
  ctx: MinimalCtx
) {
  const title = (args.title ?? "").trim();
  if (!title) throw new Error("A broadcast title is required.");
  if (title.length > 100) throw new Error("The title must be 100 characters or fewer.");

  const description = (args.description ?? "").trim();
  if (description.length > 5000) {
    throw new Error("The description must be 5000 characters or fewer.");
  }

  let start: Date;
  if (args.scheduledStartTime) {
    if (!HAS_OFFSET.test(args.scheduledStartTime)) {
      throw new Error(
        "scheduledStartTime must include a time zone offset, e.g. 2026-10-15T14:00:00+00:00 or 2026-10-15T14:00:00Z. Ask the user for their time zone."
      );
    }
    start = new Date(args.scheduledStartTime);
    if (Number.isNaN(start.getTime())) {
      throw new Error("scheduledStartTime is not a valid date and time.");
    }
  } else {
    start = new Date(Date.now() + 2 * 60_000);
  }
  // YouTube rejects start times in the past.
  if (start.getTime() < Date.now() + 30_000) {
    start = new Date(Date.now() + 60_000);
  }

  const privacy =
    args.privacy === "public" || args.privacy === "unlisted" ? args.privacy : "private";
  const latency =
    args.latency === "normal" || args.latency === "ultraLow" ? args.latency : "low";

  const token = await requireLiveToken(ctx.userId);

  const res = await fetch(`${YT_API}/liveBroadcasts?part=snippet,status,contentDetails`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      snippet: {
        title,
        description,
        scheduledStartTime: start.toISOString(),
      },
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: args.madeForKids === true,
      },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: true,
        enableDvr: true,
        enableEmbed: true,
        latencyPreference: latency,
        monitorStream: { enableMonitorStream: false },
      },
    }),
  });
  if (!res.ok) throw await liveError(res, "Failed to create the live broadcast.");
  const broadcast: Json = await res.json();
  const broadcastId: string = broadcast.id;

  // Connect the broadcast to the channel's RTMP stream.
  let stream: StreamSummary;
  try {
    stream = await getOrCreateStream(token, title);
    const bindParams = new URLSearchParams({
      id: broadcastId,
      streamId: stream.streamId,
      part: "id,contentDetails",
    });
    const bindRes = await fetch(`${YT_API}/liveBroadcasts/bind?${bindParams.toString()}`, {
      method: "POST",
      headers: authHeaders(token),
    });
    if (!bindRes.ok) throw await liveError(bindRes, "Failed to connect the stream.");
  } catch (err) {
    throw new Error(
      `The broadcast was created (id ${broadcastId}) but it could not be connected to a stream: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
  }

  return {
    created: true,
    broadcastId,
    title,
    scheduledStartTime: start.toISOString(),
    privacy,
    watchUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
    studioLink: `https://studio.youtube.com/video/${broadcastId}/livestreaming`,
    streamId: stream.streamId,
    rtmpAddress: stream.ingestionAddress,
    note: "The broadcast is scheduled and connected to the channel's stream. It does not stream video by itself: an encoder (such as OBS) must send video to the RTMP address using the stream key. With auto-start on, it goes live automatically when the encoder starts sending. To see the stream key, call get_youtube_stream_info with revealKey=true only if the user asks for it, and warn them to keep it private.",
  };
}

// -- LIST BROADCASTS -----------------------------------------------------

async function listBroadcasts(
  args: { status?: string; maxResults?: number },
  ctx: MinimalCtx
) {
  const token = await requireLiveToken(ctx.userId);
  const status =
    args.status === "active" || args.status === "completed" || args.status === "all"
      ? args.status
      : "upcoming";

  const params = new URLSearchParams({
    part: "snippet,status,contentDetails",
    broadcastStatus: status,
    maxResults: String(clampInt(args.maxResults, 10, 1, 25)),
  });
  const res = await fetch(`${YT_API}/liveBroadcasts?${params.toString()}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw await liveError(res, "Failed to list live broadcasts.");
  const data: Json = await res.json();

  const broadcasts = (data.items ?? []).map((b: Json) => ({
    broadcastId: b.id,
    title: b.snippet?.title ?? null,
    scheduledStartTime: b.snippet?.scheduledStartTime ?? null,
    actualStartTime: b.snippet?.actualStartTime ?? null,
    actualEndTime: b.snippet?.actualEndTime ?? null,
    lifeCycleStatus: b.status?.lifeCycleStatus ?? null,
    privacy: b.status?.privacyStatus ?? null,
    streamId: b.contentDetails?.boundStreamId ?? null,
    watchUrl: `https://www.youtube.com/watch?v=${b.id}`,
  }));

  if (broadcasts.length === 0) {
    return { broadcasts: [], count: 0, note: `No ${status} live broadcasts.` };
  }
  return { broadcasts, count: broadcasts.length };
}

// -- STREAM INFO (address, status, optionally the secret key) ------------

async function getStreamInfo(args: { revealKey?: boolean }, ctx: MinimalCtx) {
  const token = await requireLiveToken(ctx.userId);
  const streams = await listStreams(token);

  if (streams.length === 0) {
    return {
      streams: [],
      count: 0,
      note: "No live stream connection exists yet. It is created automatically the first time a broadcast is created.",
    };
  }

  const reveal = args.revealKey === true;
  return {
    count: streams.length,
    streams: streams.map((s) => ({
      streamId: s.streamId,
      title: s.title,
      rtmpAddress: s.ingestionAddress,
      rtmpsAddress: s.rtmpsAddress,
      streamStatus: s.streamStatus, // active = the encoder is sending video right now
      health: s.health,
      reusable: s.isReusable,
      ...(reveal ? { streamKey: s.streamKey } : { streamKey: "hidden" }),
    })),
    note: reveal
      ? "The stream key is a secret: anyone with it can broadcast on the channel. Tell the user to keep it private and not to share it."
      : "The stream key is hidden. Call this again with revealKey=true only if the user asks to see it.",
  };
}

// -- CHANGE A BROADCAST'S STATE ------------------------------------------

async function transitionBroadcast(
  args: { broadcastId: string; to: string },
  ctx: MinimalCtx
) {
  const broadcastId = String(args.broadcastId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(broadcastId)) {
    throw new Error("That is not a valid broadcast id.");
  }
  if (args.to !== "testing" && args.to !== "live" && args.to !== "complete") {
    throw new Error("The target state must be 'testing', 'live', or 'complete'.");
  }

  const token = await requireLiveToken(ctx.userId);
  const params = new URLSearchParams({
    broadcastStatus: args.to,
    id: broadcastId,
    part: "status",
  });
  const res = await fetch(`${YT_API}/liveBroadcasts/transition?${params.toString()}`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw await liveError(res, "Failed to change the broadcast state.");
  const data: Json = await res.json();

  return {
    changed: true,
    broadcastId,
    lifeCycleStatus: data.status?.lifeCycleStatus ?? args.to,
    watchUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
    note:
      args.to === "live"
        ? "Going live needs the encoder to be sending video already; YouTube refuses otherwise."
        : undefined,
  };
}

// -- REGISTRATION --------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LiveExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const LIVE_TOOL_EXECUTORS: Record<string, LiveExecutorFn> = {
  create_youtube_live_broadcast: createBroadcast,
  list_youtube_broadcasts: listBroadcasts,
  get_youtube_stream_info: getStreamInfo,
  transition_youtube_broadcast: transitionBroadcast,
};

// Public-facing actions: these always go through the Confirm card.
export const LIVE_MUTATING_TOOL_NAMES = [
  "create_youtube_live_broadcast",
  "transition_youtube_broadcast",
];

export const LIVE_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "create_youtube_live_broadcast",
    description:
      "Schedule a YouTube live broadcast on the user's channel and connect it to the channel's stream. This is a public-facing action and always requires explicit confirmation before it happens. Agree the title, description, start time, and privacy with the user first; the start time must include a time zone offset (ask for their time zone if unknown). Privacy defaults to 'private'; only use 'unlisted' or 'public' if the user asks. This does NOT stream any video: the user (or a separate server) must send video from an encoder such as OBS to the RTMP address using the stream key; with auto-start the broadcast goes live when the encoder starts sending. The channel must be enabled for live streaming in YouTube Studio first (verification can take up to 24 hours); if it is not, the tool says so.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Broadcast title (max 100 characters)." },
        description: { type: "string", description: "Broadcast description (max 5000 characters)." },
        scheduledStartTime: {
          type: "string",
          description:
            "Start time as ISO 8601 WITH a time zone offset, e.g. '2026-10-15T14:00:00+00:00' or '2026-10-15T14:00:00Z'. Defaults to a couple of minutes from now.",
        },
        privacy: {
          type: "string",
          description: "'private' (default), 'unlisted', or 'public'.",
        },
        madeForKids: {
          type: "boolean",
          description: "True if the stream is made for children. Defaults to false.",
        },
        latency: {
          type: "string",
          description:
            "'low' (default), 'normal' (best quality), or 'ultraLow' (fastest interaction, lower quality).",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "list_youtube_broadcasts",
    description:
      "List the user's YouTube live broadcasts by state: 'upcoming' (default), 'active' (live now), 'completed', or 'all'. Shows title, scheduled and actual start, state, privacy, and the watch link. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "'upcoming' (default), 'active', 'completed', or 'all'.",
        },
        maxResults: { type: "number", description: "Max broadcasts (1-25). Defaults to 10." },
      },
    },
  },
  {
    name: "get_youtube_stream_info",
    description:
      "Show the channel's live stream connection: the RTMP address, whether the encoder is currently sending video (streamStatus 'active'), and the stream health. The secret stream key is hidden unless revealKey is true; set revealKey=true ONLY when the user explicitly asks to see or copy the key, and remind them to keep it private. Use this to check that the encoder is connected before going live. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        revealKey: {
          type: "boolean",
          description: "Set true only if the user explicitly asks to see the stream key.",
        },
      },
    },
  },
  {
    name: "transition_youtube_broadcast",
    description:
      "Move a YouTube live broadcast to 'testing' (preview, only the owner sees it), 'live' (public go-live), or 'complete' (end the broadcast). This is a public-facing action and always requires explicit confirmation before it happens. Going live requires the encoder to already be sending video. Normally unnecessary, because broadcasts created here start and stop automatically with the encoder.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        broadcastId: { type: "string", description: "The broadcast id (from list_youtube_broadcasts)." },
        to: { type: "string", description: "'testing', 'live', or 'complete'." },
      },
      required: ["broadcastId", "to"],
    },
  },
];
