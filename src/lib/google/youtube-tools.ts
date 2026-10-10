// src/lib/google/youtube-tools.ts
// Read-only YouTube tools: YouTube Data API v3 (channel, videos, comments,
// search) and YouTube Analytics API (views, watch time, subscribers, etc.).
// This module also registers the AI video-creation tools from video-tools.ts
// (Veo), since those are the videos the assistant makes for YouTube.
//
// Requirements:
//  - YouTube Data API v3 and YouTube Analytics API enabled in the Google
//    Cloud project.
//  - The connected Google account must have granted the youtube.readonly
//    and yt-analytics.readonly scopes (requested by /api/auth/google/connect;
//    accounts connected before these scopes were added must reconnect).
//
// Executors are merged into GOOGLE_TOOL_EXECUTORS in gmail-calendar-tools.ts;
// definitions are spread into ASSISTANT_TOOLS in tools.ts. The AssistantTool
// import is type-only, so there is no circular import with tools.ts.

import type { AssistantTool } from "../assistant/tools";
import { prisma } from "@/lib/prisma";
import { getValidGoogleAccessToken } from "./token";
import { VIDEO_TOOL_DEFINITIONS, VIDEO_TOOL_EXECUTORS } from "./video-tools";

interface MinimalCtx {
  userId: string;
}

// Loosely-typed Google API JSON. Kept in one place so the lint
// suppression is not repeated on every use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const YT_DATA_API = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

const SCOPE_DATA = "https://www.googleapis.com/auth/youtube.readonly";
const SCOPE_ANALYTICS = "https://www.googleapis.com/auth/yt-analytics.readonly";

const NOT_CONNECTED =
  "No Google account is connected yet. Connect one at /integrations before using YouTube.";

async function requireYouTubeToken(
  userId: string,
  scope: string,
  label: string
): Promise<string> {
  const connection = await prisma.googleConnection.findUnique({
    where: { userId },
    select: { scopes: true },
  });
  if (!connection) throw new Error(NOT_CONNECTED);

  if (!connection.scopes.includes(scope)) {
    throw new Error(
      `Your connected Google account has not granted ${label} permission yet. Disconnect and reconnect your Google account at /integrations, and approve the YouTube permissions on the Google screen.`
    );
  }

  const token = await getValidGoogleAccessToken(userId);
  if (!token) throw new Error(NOT_CONNECTED);
  return token;
}

async function googleApiError(
  res: Response,
  fallback: string,
  apiName: string
): Promise<Error> {
  let message = fallback;
  try {
    const data = await res.json();
    message = data?.error?.message ?? fallback;
  } catch {
    // response body was not JSON - keep the fallback message
  }
  if (
    res.status === 403 &&
    /has not been used|is disabled|accessNotConfigured/i.test(message)
  ) {
    message += ` (Enable the ${apiName} in the Google Cloud project: APIs & Services, Library.)`;
  }
  if (res.status === 403 && /quota/i.test(message)) {
    message += " (The daily YouTube API quota may be used up; it resets daily.)";
  }
  return new Error(message);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

function videoSummary(v: Json) {
  return {
    id: v.id,
    title: v.snippet?.title ?? null,
    channelTitle: v.snippet?.channelTitle ?? null,
    publishedAt: v.snippet?.publishedAt ?? null,
    privacy: v.status?.privacyStatus ?? null,
    views: toNumberOrNull(v.statistics?.viewCount),
    likes: toNumberOrNull(v.statistics?.likeCount),
    comments: toNumberOrNull(v.statistics?.commentCount),
    duration: v.contentDetails?.duration ?? null,
    link: `https://www.youtube.com/watch?v=${v.id}`,
  };
}

// -- CHANNEL ------------------------------------------------------------

async function getYouTubeChannel(_args: unknown, ctx: MinimalCtx) {
  const token = await requireYouTubeToken(ctx.userId, SCOPE_DATA, "YouTube");

  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    mine: "true",
  });
  const res = await fetch(`${YT_DATA_API}/channels?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await googleApiError(res, "Failed to load the YouTube channel.", "YouTube Data API v3");
  }
  const data = await res.json();
  const ch: Json = data.items?.[0];

  if (!ch) {
    return {
      found: false,
      note: "No YouTube channel is linked to the connected Google account. If your channel is on a brand account, reconnect Google at /integrations and choose that channel on the Google screen.",
    };
  }

  const hidden = Boolean(ch.statistics?.hiddenSubscriberCount);
  return {
    found: true,
    channelId: ch.id,
    title: ch.snippet?.title ?? null,
    customUrl: ch.snippet?.customUrl ?? null,
    description: (ch.snippet?.description ?? "").slice(0, 500),
    createdAt: ch.snippet?.publishedAt ?? null,
    country: ch.snippet?.country ?? null,
    subscribers: hidden ? null : toNumberOrNull(ch.statistics?.subscriberCount),
    subscribersHidden: hidden,
    totalViews: toNumberOrNull(ch.statistics?.viewCount),
    videoCount: toNumberOrNull(ch.statistics?.videoCount),
    link: `https://www.youtube.com/channel/${ch.id}`,
  };
}

// -- VIDEOS -------------------------------------------------------------

async function listYouTubeVideos(args: { maxResults?: number }, ctx: MinimalCtx) {
  const token = await requireYouTubeToken(ctx.userId, SCOPE_DATA, "YouTube");
  const headers = { Authorization: `Bearer ${token}` };
  const maxResults = clampInt(args.maxResults, 10, 1, 25);

  const chRes = await fetch(
    `${YT_DATA_API}/channels?part=contentDetails&mine=true`,
    { headers }
  );
  if (!chRes.ok) {
    throw await googleApiError(chRes, "Failed to load the YouTube channel.", "YouTube Data API v3");
  }
  const chData = await chRes.json();
  const uploadsId: string | undefined =
    chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) {
    return {
      videos: [],
      count: 0,
      note: "No YouTube channel is linked to the connected Google account.",
    };
  }

  const plParams = new URLSearchParams({
    part: "contentDetails",
    playlistId: uploadsId,
    maxResults: String(maxResults),
  });
  const plRes = await fetch(`${YT_DATA_API}/playlistItems?${plParams.toString()}`, { headers });
  if (!plRes.ok) {
    throw await googleApiError(plRes, "Failed to list uploaded videos.", "YouTube Data API v3");
  }
  const plData = await plRes.json();
  const ids: string[] = (plData.items ?? [])
    .map((i: Json) => i.contentDetails?.videoId)
    .filter(Boolean);

  if (ids.length === 0) {
    return { videos: [], count: 0, note: "This channel has no uploaded videos yet." };
  }

  const vParams = new URLSearchParams({
    part: "snippet,statistics,contentDetails,status",
    id: ids.join(","),
  });
  const vRes = await fetch(`${YT_DATA_API}/videos?${vParams.toString()}`, { headers });
  if (!vRes.ok) {
    throw await googleApiError(vRes, "Failed to load video details.", "YouTube Data API v3");
  }
  const vData = await vRes.json();

  // Keep the uploads-playlist order (newest first).
  const byId = new Map<string, Json>((vData.items ?? []).map((v: Json) => [v.id, v]));
  const videos = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(videoSummary);

  return { videos, count: videos.length };
}

async function getYouTubeVideo(args: { videoId: string }, ctx: MinimalCtx) {
  const token = await requireYouTubeToken(ctx.userId, SCOPE_DATA, "YouTube");
  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails,status",
    id: args.videoId,
  });
  const res = await fetch(`${YT_DATA_API}/videos?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await googleApiError(res, "Failed to load that video.", "YouTube Data API v3");
  }
  const data = await res.json();
  const v: Json = data.items?.[0];
  if (!v) return { found: false, note: "No video found with that ID." };

  return {
    found: true,
    ...videoSummary(v),
    description: (v.snippet?.description ?? "").slice(0, 500),
    tags: (v.snippet?.tags ?? []).slice(0, 20),
  };
}

async function searchYouTubeVideos(
  args: { query: string; maxResults?: number },
  ctx: MinimalCtx
) {
  const token = await requireYouTubeToken(ctx.userId, SCOPE_DATA, "YouTube");
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: args.query,
    maxResults: String(clampInt(args.maxResults, 5, 1, 10)),
  });
  const res = await fetch(`${YT_DATA_API}/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await googleApiError(res, "YouTube search failed.", "YouTube Data API v3");
  }
  const data = await res.json();

  const results = (data.items ?? []).map((i: Json) => ({
    videoId: i.id?.videoId ?? null,
    title: i.snippet?.title ?? null,
    channelTitle: i.snippet?.channelTitle ?? null,
    publishedAt: i.snippet?.publishedAt ?? null,
    description: (i.snippet?.description ?? "").slice(0, 200),
    link: i.id?.videoId ? `https://www.youtube.com/watch?v=${i.id.videoId}` : null,
  }));

  return { results, count: results.length };
}

async function listYouTubeComments(
  args: { videoId: string; maxResults?: number; order?: string },
  ctx: MinimalCtx
) {
  const token = await requireYouTubeToken(ctx.userId, SCOPE_DATA, "YouTube");
  const params = new URLSearchParams({
    part: "snippet",
    videoId: args.videoId,
    maxResults: String(clampInt(args.maxResults, 10, 1, 25)),
    order: args.order === "relevance" ? "relevance" : "time",
    textFormat: "plainText",
  });
  const res = await fetch(`${YT_DATA_API}/commentThreads?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await googleApiError(res, "Failed to load comments.", "YouTube Data API v3");
  }
  const data = await res.json();

  const comments = (data.items ?? []).map((t: Json) => {
    const c = t.snippet?.topLevelComment?.snippet;
    return {
      author: c?.authorDisplayName ?? null,
      text: (c?.textDisplay ?? "").slice(0, 500),
      likes: toNumberOrNull(c?.likeCount),
      replies: toNumberOrNull(t.snippet?.totalReplyCount),
      publishedAt: c?.publishedAt ?? null,
    };
  });

  if (comments.length === 0) {
    return { comments: [], count: 0, note: "No comments found on that video." };
  }
  return { comments, count: comments.length };
}

// -- ANALYTICS ----------------------------------------------------------

// Only non-revenue metrics: revenue metrics need an additional monetary
// scope and a monetized channel, and are intentionally not requested.
const ALLOWED_METRICS = new Set([
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "dislikes",
  "comments",
  "shares",
  "videosAddedToPlaylists",
  "videosRemovedFromPlaylists",
]);

const ALLOWED_DIMENSIONS = new Set([
  "day",
  "month",
  "video",
  "country",
  "insightTrafficSourceType",
  "deviceType",
]);

const DEFAULT_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "comments",
  "shares",
];

function parseList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getYouTubeAnalytics(
  args: {
    startDate?: string;
    endDate?: string;
    metrics?: string;
    dimensions?: string;
    videoId?: string;
    sort?: string;
    maxResults?: number;
  },
  ctx: MinimalCtx
) {
  const token = await requireYouTubeToken(ctx.userId, SCOPE_ANALYTICS, "YouTube Analytics");
  const headers = { Authorization: `Bearer ${token}` };

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (args.startDate && !dateRe.test(args.startDate)) {
    throw new Error("startDate must be in YYYY-MM-DD format.");
  }
  if (args.endDate && !dateRe.test(args.endDate)) {
    throw new Error("endDate must be in YYYY-MM-DD format.");
  }
  const endDate = args.endDate ?? isoDate(new Date());
  const startDate =
    args.startDate ?? isoDate(new Date(new Date(endDate).getTime() - 28 * 86400000));

  const metrics = parseList(args.metrics);
  const metricList = metrics.length > 0 ? metrics : DEFAULT_METRICS;
  for (const m of metricList) {
    if (!ALLOWED_METRICS.has(m)) {
      throw new Error(
        `Unsupported metric "${m}". Allowed: ${[...ALLOWED_METRICS].join(", ")}.`
      );
    }
  }

  const dimensionList = parseList(args.dimensions);
  for (const d of dimensionList) {
    if (!ALLOWED_DIMENSIONS.has(d)) {
      throw new Error(
        `Unsupported dimension "${d}". Allowed: ${[...ALLOWED_DIMENSIONS].join(", ")}.`
      );
    }
  }

  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: metricList.join(","),
  });
  if (dimensionList.length > 0) params.set("dimensions", dimensionList.join(","));
  if (args.videoId) params.set("filters", `video==${args.videoId}`);

  if (dimensionList.length > 0) {
    const isTimeSeries = dimensionList.includes("day") || dimensionList.includes("month");
    const defaultSort = dimensionList.includes("day")
      ? "day"
      : dimensionList.includes("month")
        ? "month"
        : `-${metricList.includes("views") ? "views" : metricList[0]}`;
    params.set("sort", args.sort || defaultSort);
    if (!isTimeSeries) {
      params.set("maxResults", String(clampInt(args.maxResults, 10, 1, 50)));
    }
  }

  const res = await fetch(`${YT_ANALYTICS_API}?${params.toString()}`, { headers });
  if (!res.ok) {
    throw await googleApiError(
      res,
      "Failed to load YouTube Analytics.",
      "YouTube Analytics API"
    );
  }
  const data = await res.json();

  const columns: string[] = (data.columnHeaders ?? []).map((c: Json) => c.name);
  const rows: Record<string, unknown>[] = (data.rows ?? []).map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((name, i) => {
      obj[name] = row[i];
    });
    return obj;
  });

  // When broken down by video, look up the real titles for readability.
  if (columns.includes("video") && rows.length > 0) {
    try {
      const videoIds = rows.map((r) => String(r["video"])).slice(0, 50);
      const tParams = new URLSearchParams({ part: "snippet", id: videoIds.join(",") });
      const tRes = await fetch(`${YT_DATA_API}/videos?${tParams.toString()}`, { headers });
      if (tRes.ok) {
        const tData = await tRes.json();
        const titles = new Map<string, string>(
          (tData.items ?? []).map((v: Json) => [v.id, v.snippet?.title])
        );
        for (const r of rows) {
          r["title"] = titles.get(String(r["video"])) ?? null;
        }
      }
    } catch {
      // titles are a nicety only - the numbers are still valid without them
    }
  }

  const note =
    "YouTube Analytics data can lag by a couple of days. estimatedMinutesWatched is in minutes and averageViewDuration is in seconds.";

  if (dimensionList.length === 0) {
    return { startDate, endDate, totals: rows[0] ?? null, note };
  }
  return {
    startDate,
    endDate,
    rowCount: rows.length,
    rows,
    ...(rows.length === 0 ? { noDataNote: "No analytics data for that range." } : {}),
    note,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type YouTubeExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const YOUTUBE_TOOL_EXECUTORS: Record<string, YouTubeExecutorFn> = {
  get_youtube_channel: getYouTubeChannel,
  list_youtube_videos: listYouTubeVideos,
  get_youtube_video: getYouTubeVideo,
  search_youtube_videos: searchYouTubeVideos,
  list_youtube_comments: listYouTubeComments,
  get_youtube_analytics: getYouTubeAnalytics,
  // AI video creation with Veo (see video-tools.ts)
  ...VIDEO_TOOL_EXECUTORS,
};

// All YouTube tools are read-only, so they run immediately with no Confirm card.
export const YOUTUBE_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "get_youtube_channel",
    description:
      "Get the user's own YouTube channel overview: title, subscriber count, total views, video count, and link. Call this immediately whenever the user asks about their YouTube channel - do not tell them to connect first; only report that if this tool itself returns a not-connected error. Read-only.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_youtube_videos",
    description:
      "List the user's most recent uploaded YouTube videos with title, publish date, privacy status, views, likes, comments, duration, and link. Newest first. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        maxResults: { type: "number", description: "Max videos (1-25). Defaults to 10." },
      },
    },
  },
  {
    name: "get_youtube_video",
    description:
      "Get details and public statistics (views, likes, comments, duration, tags, description) for one YouTube video by its video ID. Works for any public video, not just the user's own. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        videoId: { type: "string", description: "The YouTube video ID (the part after v= in the URL)." },
      },
      required: ["videoId"],
    },
  },
  {
    name: "search_youtube_videos",
    description:
      "Search all of YouTube for videos matching a query (useful for market, competitor, or topic research). Returns title, channel, publish date, snippet, and link. Uses a large share of the daily YouTube API quota, so use it only when the user actually asks to search YouTube. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        maxResults: { type: "number", description: "Max results (1-10). Defaults to 5." },
      },
      required: ["query"],
    },
  },
  {
    name: "list_youtube_comments",
    description:
      "List top-level comments on a YouTube video (author, text, likes, reply count). Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        videoId: { type: "string", description: "The YouTube video ID." },
        maxResults: { type: "number", description: "Max comments (1-25). Defaults to 10." },
        order: { type: "string", description: "'time' (newest first, default) or 'relevance' (top comments)." },
      },
      required: ["videoId"],
    },
  },
  {
    name: "get_youtube_analytics",
    description:
      "Get real YouTube Analytics for the user's own channel over a date range: views, watch time, average view duration, subscribers gained/lost, likes, comments, shares. With no dimensions it returns channel totals; set dimensions to break down by day, month, video, country, insightTrafficSourceType (where viewers came from), or deviceType. Defaults to the last 28 days. Data can lag a couple of days. Never state YouTube performance numbers without calling this or another YouTube tool. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD. Defaults to 28 days before endDate." },
        endDate: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        metrics: {
          type: "string",
          description:
            "Optional comma-separated metrics from: views, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, subscribersGained, subscribersLost, likes, dislikes, comments, shares, videosAddedToPlaylists, videosRemovedFromPlaylists. Defaults to a standard set.",
        },
        dimensions: {
          type: "string",
          description:
            "Optional comma-separated breakdown from: day, month, video, country, insightTrafficSourceType, deviceType.",
        },
        videoId: { type: "string", description: "Optional: limit to a single video by ID." },
        sort: { type: "string", description: "Optional sort column; prefix with - for descending, e.g. '-views'." },
        maxResults: { type: "number", description: "Max rows for non-time breakdowns (1-50). Defaults to 10." },
      },
    },
  },
  // AI video creation with Veo (see video-tools.ts)
  ...VIDEO_TOOL_DEFINITIONS,
];
