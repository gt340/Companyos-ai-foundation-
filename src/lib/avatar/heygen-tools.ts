// src/lib/avatar/heygen-tools.ts
// AI presenter (avatar) videos with HeyGen: pick a stock presenter and a stock
// voice (or a company presenter / company voice created inside HeyGen), turn
// an approved script into a talking-presenter video, check on it, and save the
// finished MP4 to the user's Google Drive (from where it can be uploaded to
// YouTube with upload_youtube_video).
//
// Uses the HEYGEN_API_KEY server environment variable. Everyone shares that one
// HeyGen account (the platform pays), so:
//   - HEYGEN_ENABLED_ORG_IDS (comma-separated organization ids) says which
//     companies may use it. Companies not listed are refused. This also keeps
//     custom presenters/voices on the account from being exposed to companies
//     they do not belong to.
//   - Videos are made in TEST mode by default (watermarked, does not use
//     credits). A FINAL video counts against the company's monthly allowance of
//     video seconds: AVATAR_MONTHLY_SECONDS_LIMIT (default 180 = 3 minutes),
//     and always needs the user's explicit approval first.
//   - Usage is recorded in the existing video_generation_jobs table (model
//     "heygen", durationSeconds = estimated seconds, estimatedCostUsd = 0 so
//     it never counts against the Veo dollar budget). The HeyGen video id is
//     stored only as a SHA-256 hash.
//
// This is NOT a live/real-time presenter: it makes pre-recorded presenter
// videos. Live streaming with an AI host is a separate step.
//
// Registered through src/lib/integrations/registry.ts. The AssistantTool
// import is type-only, so there is no circular import with tools.ts.

import { createHash } from "crypto";
import type { AssistantTool } from "../assistant/tools";
import { prisma } from "@/lib/prisma";
import { getActiveOrganizationId } from "@/lib/active-org";
import { getValidGoogleAccessToken } from "../google/token";

interface MinimalCtx {
  userId: string;
}

// Loosely-typed external API JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const HEYGEN_API = "https://api.heygen.com";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

const MAX_SCRIPT_CHARS = 3000;
const WORDS_PER_SECOND = 2.5; // about 150 spoken words per minute
const DEFAULT_MONTHLY_SECONDS = 180;
const MAX_DRIVE_VIDEO_BYTES = 60 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{4,100}$/;

const MODEL_FINAL = "heygen";
const MODEL_TEST = "heygen-test";

function requireHeyGenKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    throw new Error("HEYGEN_API_KEY is not set on the server, so AI presenter videos are unavailable.");
  }
  return key;
}

async function heygenError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const data: Json = await res.json();
    message = data?.error?.message ?? data?.message ?? data?.error ?? fallback;
    if (typeof message !== "string") message = fallback;
  } catch {
    // response body was not JSON - keep the fallback message
  }
  if (res.status === 401 || res.status === 403) {
    message += " (Check that HEYGEN_API_KEY is valid and that the HeyGen plan includes API access.)";
  } else if (res.status === 429 || /credit|quota|limit/i.test(message)) {
    message += " (The HeyGen account may be out of credits or API quota.)";
  }
  return new Error(message);
}

function heygenHeaders(): Record<string, string> {
  return { "X-Api-Key": requireHeyGenKey(), Accept: "application/json" };
}

function secondsLimit(): number {
  const raw = process.env.AVATAR_MONTHLY_SECONDS_LIMIT;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return DEFAULT_MONTHLY_SECONDS;
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

// -- COMPANY + ACCESS ----------------------------------------------------

async function resolveOrganizationId(ctx: MinimalCtx): Promise<string> {
  const fromContext = (ctx as MinimalCtx & { organizationId?: string }).organizationId;
  if (fromContext) return fromContext;
  let organizationId: string | null = null;
  try {
    organizationId = await getActiveOrganizationId(ctx.userId);
  } catch {
    organizationId = null;
  }
  if (!organizationId) {
    throw new Error("Could not tell which company this presenter-video request is for.");
  }
  return organizationId;
}

// Only companies listed in HEYGEN_ENABLED_ORG_IDS may use the shared account.
async function requireEnabledOrganization(ctx: MinimalCtx): Promise<string> {
  const organizationId = await resolveOrganizationId(ctx);
  const allowed = (process.env.HEYGEN_ENABLED_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(organizationId)) {
    throw new Error(
      "AI presenter videos are not enabled for this company yet. The platform admin can enable them."
    );
  }
  return organizationId;
}

// -- USAGE ---------------------------------------------------------------

interface AvatarBudget {
  monthlySecondsLimit: number;
  usedSecondsThisMonth: number;
  remainingSeconds: number;
  resetsOn: string;
}

async function getAvatarBudget(organizationId: string): Promise<AvatarBudget> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const sum = await prisma.videoGenerationJob.aggregate({
    _sum: { durationSeconds: true },
    where: {
      organizationId,
      model: MODEL_FINAL,
      createdAt: { gte: monthStart },
      status: { in: ["started", "ready"] },
    },
  });

  const limit = secondsLimit();
  const used = sum._sum.durationSeconds ?? 0;
  return {
    monthlySecondsLimit: limit,
    usedSecondsThisMonth: used,
    remainingSeconds: Math.max(limit - used, 0),
    resetsOn: nextMonth.toISOString().slice(0, 10),
  };
}

async function getAvatarBudgetTool(_args: unknown, ctx: MinimalCtx) {
  const organizationId = await requireEnabledOrganization(ctx);
  const budget = await getAvatarBudget(organizationId);
  return {
    ...budget,
    note: `Final (non-watermarked) presenter videos count against this company's monthly allowance: ${budget.remainingSeconds} of ${budget.monthlySecondsLimit} seconds remain until ${budget.resetsOn}. Test videos (watermarked) are free and do not count.`,
  };
}

// -- LIST PRESENTERS AND VOICES -----------------------------------------

async function listPresenters(
  args: { gender?: string; search?: string; maxResults?: number },
  ctx: MinimalCtx
) {
  await requireEnabledOrganization(ctx);

  const res = await fetch(`${HEYGEN_API}/v2/avatars`, { headers: heygenHeaders() });
  if (!res.ok) throw await heygenError(res, "Failed to load the presenter list.");
  const data: Json = await res.json();

  const gender = (args.gender ?? "").toLowerCase();
  const search = (args.search ?? "").toLowerCase();
  const max = Math.min(Math.max(Math.floor(Number(args.maxResults) || 20), 1), 40);

  const presenters = ((data?.data?.avatars ?? []) as Json[])
    .filter((a) => (gender ? String(a.gender ?? "").toLowerCase() === gender : true))
    .filter((a) => (search ? String(a.avatar_name ?? "").toLowerCase().includes(search) : true))
    .slice(0, max)
    .map((a) => ({
      avatarId: a.avatar_id,
      name: a.avatar_name ?? null,
      gender: a.gender ?? null,
      previewImage: a.preview_image_url ?? null,
      previewVideo: a.preview_video_url ?? null,
    }));

  return {
    presenters,
    count: presenters.length,
    note: "Show the user a few options (name and preview image) and let them choose. Then use list_presenter_voices to choose a voice.",
  };
}

async function listVoices(
  args: { language?: string; gender?: string; search?: string; maxResults?: number },
  ctx: MinimalCtx
) {
  await requireEnabledOrganization(ctx);

  const res = await fetch(`${HEYGEN_API}/v2/voices`, { headers: heygenHeaders() });
  if (!res.ok) throw await heygenError(res, "Failed to load the voice list.");
  const data: Json = await res.json();

  const language = (args.language ?? "English").toLowerCase();
  const gender = (args.gender ?? "").toLowerCase();
  const search = (args.search ?? "").toLowerCase();
  const max = Math.min(Math.max(Math.floor(Number(args.maxResults) || 20), 1), 40);

  const voices = ((data?.data?.voices ?? []) as Json[])
    .filter((v) => String(v.language ?? "").toLowerCase().includes(language))
    .filter((v) => (gender ? String(v.gender ?? "").toLowerCase() === gender : true))
    .filter((v) => (search ? String(v.name ?? "").toLowerCase().includes(search) : true))
    .slice(0, max)
    .map((v) => ({
      voiceId: v.voice_id,
      name: v.name ?? null,
      language: v.language ?? null,
      gender: v.gender ?? null,
      previewAudio: v.preview_audio ?? null,
    }));

  return {
    voices,
    count: voices.length,
    note: "Voices include HeyGen's stock voices and any company voice created inside HeyGen. Ask the user whether they want a stock voice or the company voice, and let them pick.",
  };
}

// -- CREATE A PRESENTER VIDEO -------------------------------------------

function estimateSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(Math.ceil(words / WORDS_PER_SECOND), 5);
}

async function generateAvatarVideo(
  args: {
    script: string;
    avatarId: string;
    voiceId: string;
    title?: string;
    aspectRatio?: string;
    captions?: boolean;
    finalVideo?: boolean;
    userApprovedUsage?: boolean;
  },
  ctx: MinimalCtx
) {
  const organizationId = await requireEnabledOrganization(ctx);

  const script = (args.script ?? "").trim();
  if (!script) throw new Error("Provide the script the presenter should say.");
  if (script.length > MAX_SCRIPT_CHARS) {
    throw new Error(
      `The script is too long (${script.length} characters; limit ${MAX_SCRIPT_CHARS}). Split it into shorter videos.`
    );
  }
  if (!ID_PATTERN.test(String(args.avatarId ?? ""))) {
    throw new Error("Provide a presenter avatarId from list_presenter_avatars.");
  }
  if (!ID_PATTERN.test(String(args.voiceId ?? ""))) {
    throw new Error("Provide a voiceId from list_presenter_voices.");
  }

  const finalVideo = args.finalVideo === true;
  const estimatedSeconds = estimateSeconds(script);
  const aspect = args.aspectRatio === "9:16" ? "9:16" : "16:9";
  const dimension =
    aspect === "9:16" ? { width: 720, height: 1280 } : { width: 1280, height: 720 };

  if (finalVideo) {
    const budget = await getAvatarBudget(organizationId);

    if (estimatedSeconds > budget.remainingSeconds) {
      return {
        started: false,
        overBudget: true,
        estimatedSeconds,
        ...budget,
        message: `Not started. This script is about ${estimatedSeconds} seconds of video, but only ${budget.remainingSeconds} of this company's ${budget.monthlySecondsLimit} monthly presenter-video seconds remain (resets ${budget.resetsOn}). Suggest a shorter script, or a free test video, or waiting for the reset. The platform admin can raise the limit.`,
      };
    }

    if (args.userApprovedUsage !== true) {
      return {
        started: false,
        needsApproval: true,
        estimatedSeconds,
        ...budget,
        message: `Not started. A FINAL (no watermark) video of about ${estimatedSeconds} seconds uses HeyGen credits and counts against this company's monthly allowance (${budget.remainingSeconds} of ${budget.monthlySecondsLimit} seconds remain). Tell the user the script, the chosen presenter and voice, and that a free watermarked TEST video is available first. Ask whether to go ahead; only call generate_avatar_video again with userApprovedUsage=true after they clearly say yes.`,
      };
    }
  }

  const body = {
    title: (args.title ?? "CompanyOS presenter video").slice(0, 100),
    caption: args.captions !== false,
    test: !finalVideo,
    dimension,
    video_inputs: [
      {
        character: {
          type: "avatar",
          avatar_id: args.avatarId,
          avatar_style: "normal",
        },
        voice: {
          type: "text",
          input_text: script,
          voice_id: args.voiceId,
        },
        background: { type: "color", value: "#FFFFFF" },
      },
    ],
  };

  const res = await fetch(`${HEYGEN_API}/v2/video/generate`, {
    method: "POST",
    headers: { ...heygenHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await heygenError(res, "Failed to start the presenter video.");
  const data: Json = await res.json();
  const videoId: string | undefined = data?.data?.video_id;
  if (!videoId) throw new Error("HeyGen did not return a video id.");

  try {
    await prisma.videoGenerationJob.create({
      data: {
        organizationId,
        requestedByUserId: ctx.userId,
        jobHash: hashId(`heygen:${videoId}`),
        model: finalVideo ? MODEL_FINAL : MODEL_TEST,
        quality: finalVideo ? "final" : "test",
        durationSeconds: estimatedSeconds,
        estimatedCostUsd: 0,
        status: "started",
      },
    });
  } catch (err) {
    console.error("Failed to record presenter video usage:", err);
  }

  return {
    started: true,
    videoId,
    mode: finalVideo ? "final" : "test (watermarked, free)",
    aspectRatio: aspect,
    estimatedSeconds,
    note: "Presenter videos take a few minutes to render. Give the user this videoId exactly as written and tell them to ask you to check on it in a few minutes. Do not call check_avatar_video again in this same reply.",
  };
}

// -- CHECK A PRESENTER VIDEO --------------------------------------------

async function fetchVideoStatus(videoId: string): Promise<Json> {
  const res = await fetch(
    `${HEYGEN_API}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    { headers: heygenHeaders() }
  );
  if (!res.ok) throw await heygenError(res, "Failed to check the presenter video.");
  const data: Json = await res.json();
  return data?.data ?? {};
}

async function assertOwnJob(organizationId: string, videoId: string) {
  const jobHash = hashId(`heygen:${videoId}`);
  const job = await prisma.videoGenerationJob.findUnique({
    where: { jobHash },
    select: { organizationId: true, status: true },
  });
  if (!job || job.organizationId !== organizationId) {
    throw new Error(
      "No presenter video with that id was found for this company. Ask the user for the videoId given when it was started."
    );
  }
  return { jobHash, status: job.status };
}

async function checkAvatarVideo(args: { videoId: string }, ctx: MinimalCtx) {
  const organizationId = await requireEnabledOrganization(ctx);
  const videoId = String(args.videoId ?? "").trim();
  if (!ID_PATTERN.test(videoId)) throw new Error("That is not a valid presenter videoId.");

  const { jobHash, status: recorded } = await assertOwnJob(organizationId, videoId);
  const status = await fetchVideoStatus(videoId);
  const state: string = String(status.status ?? "");

  const setStatus = async (next: "ready" | "failed") => {
    if (recorded === next) return;
    try {
      await prisma.videoGenerationJob.updateMany({
        where: { jobHash, organizationId },
        data: { status: next },
      });
    } catch (err) {
      console.error("Failed to update presenter video usage status:", err);
    }
  };

  if (state === "completed") {
    await setStatus("ready");
    return {
      status: "ready",
      videoUrl: status.video_url ?? null,
      thumbnailUrl: status.thumbnail_url ?? null,
      durationSeconds: status.duration ?? null,
      note: "The video is ready. Give the user the videoUrl (a temporary HeyGen link that expires after a few days). Offer save_avatar_video_to_drive so they keep it, and then upload_youtube_video to publish it.",
    };
  }

  if (state === "failed") {
    await setStatus("failed");
    return {
      status: "failed",
      error: status.error?.message ?? status.error ?? "HeyGen could not make the video.",
      note: "A failed video is not counted against the company's monthly allowance.",
    };
  }

  return {
    status: state || "processing",
    note: "Still rendering. Tell the user to ask again in a few minutes. Do not keep re-checking in this same reply.",
  };
}

// -- SAVE TO GOOGLE DRIVE -----------------------------------------------

async function saveAvatarVideoToDrive(args: { videoId: string }, ctx: MinimalCtx) {
  const organizationId = await requireEnabledOrganization(ctx);
  const videoId = String(args.videoId ?? "").trim();
  if (!ID_PATTERN.test(videoId)) throw new Error("That is not a valid presenter videoId.");

  await assertOwnJob(organizationId, videoId);

  const status = await fetchVideoStatus(videoId);
  if (String(status.status ?? "") !== "completed" || !status.video_url) {
    throw new Error("That presenter video is not finished yet. Check on it again in a few minutes.");
  }

  const googleToken = await getValidGoogleAccessToken(ctx.userId);
  if (!googleToken) {
    throw new Error(
      "No Google account is connected yet. Connect one at /integrations so the video can be saved to Google Drive."
    );
  }

  const videoRes = await fetch(status.video_url as string);
  if (!videoRes.ok) throw new Error("Failed to download the finished video from HeyGen.");
  const bytes = new Uint8Array(await videoRes.arrayBuffer());
  if (bytes.length > MAX_DRIVE_VIDEO_BYTES) {
    throw new Error("The video is too large to save from here (limit 60 MB).");
  }

  const fileName = `Presenter video - ${new Date().toISOString().slice(0, 10)} - ${videoId.slice(0, 8)}.mp4`;

  // Resumable upload to Drive (works for files larger than 5 MB).
  const startRes = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${googleToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(bytes.length),
      },
      body: JSON.stringify({ name: fileName, mimeType: "video/mp4" }),
    }
  );
  if (!startRes.ok) throw new Error("Google Drive refused to start the upload.");
  const sessionUrl = startRes.headers.get("location");
  if (!sessionUrl) throw new Error("Google Drive did not return an upload address.");

  const putRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${googleToken}`, "Content-Type": "video/mp4" },
    body: bytes,
  });
  if (!putRes.ok) throw new Error("The upload to Google Drive failed.");
  const saved: Json = await putRes.json();

  return {
    saved: true,
    driveFileId: saved.id,
    fileName: saved.name,
    link: saved.webViewLink ?? null,
    note: "Saved to the user's Google Drive. To publish it, use upload_youtube_video with this driveFileId (it defaults to private).",
  };
}

// -- REGISTRATION --------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AvatarExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const AVATAR_TOOL_EXECUTORS: Record<string, AvatarExecutorFn> = {
  list_presenter_avatars: listPresenters,
  list_presenter_voices: listVoices,
  generate_avatar_video: generateAvatarVideo,
  check_avatar_video: checkAvatarVideo,
  get_avatar_budget: getAvatarBudgetTool,
  save_avatar_video_to_drive: saveAvatarVideoToDrive,
};

// Saving to Drive writes a file to the user's account, so it is the only
// confirm-gated tool here. The cost is gated by the approval argument and the
// monthly allowance instead (the confirm flow cannot carry a video id between
// turns).
export const AVATAR_MUTATING_TOOL_NAMES = ["save_avatar_video_to_drive"];

export const AVATAR_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "list_presenter_avatars",
    description:
      "List the AI presenters (avatars) available for presenter videos: name, gender, and a preview image. Call it when the user wants an AI presenter or host for a video; show a few options and let them choose. Read-only. Only works for companies the platform admin has enabled.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        gender: { type: "string", description: "Optional: 'male' or 'female'." },
        search: { type: "string", description: "Optional text to match in the presenter name." },
        maxResults: { type: "number", description: "Max presenters (1-40). Defaults to 20." },
      },
    },
  },
  {
    name: "list_presenter_voices",
    description:
      "List the voices available for the AI presenter: HeyGen's stock voices and any company voice created inside HeyGen. Filter by language (default English), gender, or name. ALWAYS ask the user whether they want a stock voice or the company voice, and let them pick. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", description: "Language to match, e.g. 'English' (default), 'French', 'Spanish'." },
        gender: { type: "string", description: "Optional: 'male' or 'female'." },
        search: { type: "string", description: "Optional text to match in the voice name, e.g. the company voice's name." },
        maxResults: { type: "number", description: "Max voices (1-40). Defaults to 20." },
      },
    },
  },
  {
    name: "generate_avatar_video",
    description:
      "Make a video of an AI presenter speaking an approved script, with a chosen presenter (avatarId) and voice (voiceId). The script must already be agreed with the user, should be spoken-style, factual (no unverifiable product claims), and should say the presenter is an AI. By default this makes a free, watermarked TEST video. Set finalVideo=true only when the user wants the final no-watermark video: that uses HeyGen credits and the company's monthly allowance of video seconds, so first tell the user the script, presenter, voice and estimated length, ask whether to go ahead, and only after they clearly say yes pass userApprovedUsage=true. Rendering takes a few minutes, so this only STARTS the video and returns a videoId: give the user that videoId exactly as returned and tell them to ask you to check on it later; do not call check_avatar_video in the same reply. Max 3000 characters. Landscape (16:9) or vertical (9:16).",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "The words the presenter speaks (max 3000 characters)." },
        avatarId: { type: "string", description: "The presenter's avatarId from list_presenter_avatars." },
        voiceId: { type: "string", description: "The voiceId from list_presenter_voices." },
        title: { type: "string", description: "Optional video title." },
        aspectRatio: { type: "string", description: "'16:9' landscape (default) or '9:16' vertical." },
        captions: { type: "boolean", description: "Burn in captions. Defaults to true." },
        finalVideo: {
          type: "boolean",
          description: "True for a final no-watermark video that uses credits. Defaults to false (free test video).",
        },
        userApprovedUsage: {
          type: "boolean",
          description:
            "Set true ONLY after the user explicitly agreed, in this conversation, to a FINAL video using credits and the monthly allowance.",
        },
      },
      required: ["script", "avatarId", "voiceId"],
    },
  },
  {
    name: "check_avatar_video",
    description:
      "Check on a presenter video started with generate_avatar_video, using its videoId (copy it exactly from earlier in the conversation; if it is not there, ask the user). Returns 'processing', 'ready' (with a temporary videoUrl), or 'failed'. Call it once per user request, not repeatedly. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        videoId: { type: "string", description: "The videoId returned by generate_avatar_video." },
      },
      required: ["videoId"],
    },
  },
  {
    name: "get_avatar_budget",
    description:
      "Show the company's monthly allowance of final presenter-video seconds: the limit, how much has been used, how much remains, and when it resets. Test videos are free and not counted. Read-only.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "save_avatar_video_to_drive",
    description:
      "Save a finished presenter video (by its videoId) as an MP4 in the user's Google Drive, so it is kept (HeyGen's link expires) and can then be published with upload_youtube_video using the returned driveFileId. Always requires explicit confirmation. The video must be finished first (check_avatar_video).",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        videoId: { type: "string", description: "The finished presenter videoId." },
      },
      required: ["videoId"],
    },
  },
];
