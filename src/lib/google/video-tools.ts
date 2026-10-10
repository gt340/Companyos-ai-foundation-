// src/lib/google/video-tools.ts
// AI video generation with Google's Veo models through the Gemini API.
//
// Uses the GEMINI_API_KEY environment variable. Veo has no free tier, so the
// key must belong to a Google project with billing enabled.
//
// Video generation takes 1-6 minutes, longer than one chat request is allowed
// to run, so it is split into two read-only tools:
//   generate_video       starts a job and returns a jobId (Gemini operation name)
//   check_video_status   polls the job; when ready, returns the file id and a
//                        preview link served by /api/assistant/video
//
// Executors are merged into GOOGLE_TOOL_EXECUTORS via youtube-tools.ts and
// definitions are spread into ASSISTANT_TOOLS via youtube-tools.ts. The
// AssistantTool import is type-only, so there is no circular import.

import type { AssistantTool } from "../assistant/tools";

interface MinimalCtx {
  userId: string;
}

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

type Quality = "lite" | "fast" | "standard";

const MODELS: Record<Quality, string> = {
  lite: "veo-3.1-lite-generate-preview",
  fast: "veo-3.1-fast-generate-preview",
  standard: "veo-3.1-generate-preview",
};

// Approximate Gemini API list prices in USD per generated second at 720p.
// Used only for the cost estimate shown to the user before generating;
// Google's pricing page is the source of truth and can change.
const PRICE_PER_SECOND_720P: Record<Quality, number> = {
  lite: 0.05,
  fast: 0.1,
  standard: 0.4,
};

const ALLOWED_DURATIONS = [4, 6, 8];
const MAX_PROMPT_CHARS = 4000;

function requireGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set on the server, so video generation is unavailable."
    );
  }
  return key;
}

function resolveAppBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://companyos-ai-foundation.vercel.app";
  return raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : `https://${raw}`;
}

async function geminiError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const data = await res.json();
    message = data?.error?.message ?? fallback;
  } catch {
    // response body was not JSON - keep the fallback message
  }
  if (res.status === 429) {
    message +=
      " (Gemini API rate limit or quota reached. Video generation also needs a Gemini API key on a project with billing enabled.)";
  } else if (res.status === 403 || res.status === 401) {
    message +=
      " (Check that GEMINI_API_KEY is valid and that the Google project behind it has billing enabled for video generation.)";
  }
  return new Error(message);
}

function normalizeQuality(value: unknown): Quality {
  return value === "lite" || value === "standard" ? value : "fast";
}

function estimateCostUsd(quality: Quality, seconds: number): number {
  return Math.round(PRICE_PER_SECOND_720P[quality] * seconds * 100) / 100;
}

// -- START A VIDEO JOB ---------------------------------------------------

async function generateVideo(
  args: {
    prompt: string;
    quality?: string;
    aspectRatio?: string;
    durationSeconds?: number;
    userApprovedCost?: boolean;
  },
  // ctx is part of the shared executor signature; this tool does not need it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx: MinimalCtx
) {
  const prompt = (args.prompt ?? "").trim();
  if (!prompt) throw new Error("A video description (prompt) is required.");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(
      `The video description is too long (${prompt.length} characters; limit ${MAX_PROMPT_CHARS}). Shorten it.`
    );
  }

  const quality = normalizeQuality(args.quality);
  const aspectRatio = args.aspectRatio === "9:16" ? "9:16" : "16:9";
  const durationSeconds = ALLOWED_DURATIONS.includes(Number(args.durationSeconds))
    ? Number(args.durationSeconds)
    : 8;
  const estimatedCostUsd = estimateCostUsd(quality, durationSeconds);

  // Real money is spent per generated second, so a generation only starts
  // once the user has explicitly agreed to the estimated cost in chat.
  if (args.userApprovedCost !== true) {
    return {
      started: false,
      needsApproval: true,
      quality,
      aspectRatio,
      durationSeconds,
      estimatedCostUsd,
      message: `Not started. Tell the user the description you plan to use and that this will cost roughly $${estimatedCostUsd} (${durationSeconds}s, ${quality} quality, 720p), then ask whether to go ahead. Only call generate_video again with userApprovedCost=true after they clearly say yes.`,
    };
  }

  const key = requireGeminiKey();
  const model = MODELS[quality];

  const res = await fetch(`${GEMINI_API}/models/${model}:predictLongRunning`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        aspectRatio,
        resolution: "720p",
        durationSeconds,
      },
    }),
  });
  if (!res.ok) throw await geminiError(res, "Failed to start video generation.");

  const data = await res.json();
  const jobId: string | undefined = data?.name;
  if (!jobId) {
    throw new Error("Gemini did not return a job id for the video generation.");
  }

  return {
    started: true,
    jobId,
    model,
    quality,
    aspectRatio,
    durationSeconds,
    resolution: "720p",
    estimatedCostUsd,
    note: "Video generation usually takes 1 to 6 minutes. Give the user this jobId exactly as written and tell them to ask you to check on the video in a minute or two.",
  };
}

// -- CHECK A VIDEO JOB ---------------------------------------------------

const JOB_ID_PATTERN = /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+$/;
const FILE_ID_PATTERN = /files\/([A-Za-z0-9_-]+)/;

async function checkVideoStatus(
  args: { jobId: string },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx: MinimalCtx
) {
  const jobId = (args.jobId ?? "").trim();
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      "That is not a valid video jobId. It looks like models/<model>/operations/<id> and comes from generate_video. Ask the user for it if it is not in the conversation."
    );
  }

  const key = requireGeminiKey();
  const res = await fetch(`${GEMINI_API}/${jobId}`, {
    headers: { "x-goog-api-key": key },
  });
  if (res.status === 404) {
    return {
      status: "not_found",
      note: "Google has no record of that job. It may have expired (jobs and videos are kept for about 2 days) or the jobId is wrong.",
    };
  }
  if (!res.ok) throw await geminiError(res, "Failed to check the video job.");

  const data = await res.json();

  if (!data.done) {
    return {
      status: "processing",
      note: "Still generating. Tell the user to ask again in a minute or so. Do not keep re-checking in this same reply.",
    };
  }

  if (data.error) {
    return {
      status: "failed",
      error: data.error.message ?? "Video generation failed.",
    };
  }

  const response = data.response?.generateVideoResponse;
  const samples: unknown[] = response?.generatedSamples ?? [];

  if (samples.length === 0) {
    return {
      status: "blocked",
      reasons: response?.raiMediaFilteredReasons ?? [],
      note: "Google's safety filters blocked this video, so nothing was generated and there is no charge. Suggest rewording the description.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uri: string | undefined = (samples[0] as any)?.video?.uri;
  const fileId = uri ? FILE_ID_PATTERN.exec(uri)?.[1] : undefined;
  if (!fileId) {
    return {
      status: "failed",
      error: "The video finished but Google returned no downloadable file.",
    };
  }

  return {
    status: "ready",
    fileId,
    previewUrl: `${resolveAppBaseUrl()}/api/assistant/video?f=${fileId}`,
    note: "The video is ready. Give the user the previewUrl (they must be signed in to the app to open it) and the fileId. Google keeps the file for about 2 days.",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VideoExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const VIDEO_TOOL_EXECUTORS: Record<string, VideoExecutorFn> = {
  generate_video: generateVideo,
  check_video_status: checkVideoStatus,
};

// Both are marked read-only so they run inline without a Confirm card (the
// confirm flow cannot carry a job id between turns). Cost control is done in
// the conversation instead: generate_video refuses to start unless the user
// has approved the estimated cost.
export const VIDEO_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "generate_video",
    description:
      "Start generating a short AI video (4 to 8 seconds, with native audio) from a text description, using Google's Veo model. This costs real money (about $0.05 per second for quality 'lite', $0.10 for 'fast' (default), $0.40 for 'standard'; an 8 second 'fast' video is about $0.80). ALWAYS first tell the user the exact description you plan to use and the estimated cost, and ask whether to go ahead; only after they clearly say yes, call this with userApprovedCost=true. Generation takes 1 to 6 minutes, so this only STARTS the job and returns a jobId. Give the user the jobId exactly as returned and tell them to ask you to check on it later; do not call check_video_status in the same reply. Output is 720p, landscape (16:9) or vertical (9:16, good for YouTube Shorts). Descriptions work best when they name the subject, action, style, camera movement, and any spoken lines or sounds. For still images use generate_image instead.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed description of the video: subject, action, setting, visual style, camera movement, and any dialogue (in quotes) or sound effects.",
        },
        quality: {
          type: "string",
          description:
            "'lite' (cheapest), 'fast' (default, good balance), or 'standard' (highest quality, most expensive).",
        },
        aspectRatio: {
          type: "string",
          description: "'16:9' landscape (default) or '9:16' vertical for Shorts.",
        },
        durationSeconds: {
          type: "number",
          description: "Video length in seconds: 4, 6, or 8 (default 8).",
        },
        userApprovedCost: {
          type: "boolean",
          description:
            "Set true ONLY after the user has explicitly agreed, in this conversation, to the estimated cost and the description. Leave false or omit until then.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "check_video_status",
    description:
      "Check on a video that was started with generate_video, using its jobId (copy it exactly from earlier in the conversation; if it is not there, ask the user for it). Returns 'processing' (not ready yet), 'ready' (with a previewUrl the user can open while signed in, and the fileId), 'blocked' (safety filter, no charge), or 'failed'. When ready, give the user the previewUrl and the fileId. Call it once per user request, not repeatedly.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description:
            "The jobId returned by generate_video, like models/veo-3.1-fast-generate-preview/operations/abc123.",
        },
      },
      required: ["jobId"],
    },
  },
];
