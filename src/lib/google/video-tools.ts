// src/lib/google/video-tools.ts
// AI video generation with Google's Veo models through the Gemini API.
//
// Uses the GEMINI_API_KEY environment variable. Veo has no free tier, so the
// key must belong to a Google project with billing enabled.
//
// All companies share this one key (the platform pays the bill), so every
// company has a MONTHLY DOLLAR BUDGET for video generation:
//   - default: VIDEO_DEFAULT_MONTHLY_BUDGET_USD (server variable), or $5 if unset
//   - per-company override: a row in the video_budgets table
//   - spend = sum of the estimated cost of videos started this UTC month
//     (stored in video_generation_jobs; failed/blocked videos are not charged)
// A video that would go over the remaining budget is not started.
//
// Video generation takes 1-6 minutes, longer than one chat request is allowed
// to run, so it is split into two read-only tools:
//   generate_video       starts a job and returns a jobId (Gemini operation name)
//   check_video_status   polls the job; when ready, returns the file id and a
//                        preview link served by /api/assistant/video
// plus get_video_budget, which shows the company's remaining budget.
//
// This module also registers upload_youtube_video (see youtube-upload.ts),
// the confirm-gated tool that publishes a generated (or Drive) video.
//
// Executors are merged into GOOGLE_TOOL_EXECUTORS via youtube-tools.ts and
// definitions are spread into ASSISTANT_TOOLS via youtube-tools.ts. The
// AssistantTool import is type-only, so there is no circular import.

import { createHash } from "crypto";
import type { AssistantTool } from "../assistant/tools";
import { prisma } from "@/lib/prisma";
import { getActiveOrganizationId } from "@/lib/active-org";
import { UPLOAD_TOOL_DEFINITIONS, UPLOAD_TOOL_EXECUTORS } from "./youtube-upload";

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
// Used for the cost estimate shown to the user and for budget tracking;
// Google's pricing page is the source of truth and can change.
const PRICE_PER_SECOND_720P: Record<Quality, number> = {
  lite: 0.05,
  fast: 0.1,
  standard: 0.4,
};

const ALLOWED_DURATIONS = [4, 6, 8];
const MAX_PROMPT_CHARS = 4000;
const FALLBACK_MONTHLY_BUDGET_USD = 5;

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function estimateCostUsd(quality: Quality, seconds: number): number {
  return round2(PRICE_PER_SECOND_720P[quality] * seconds);
}

// -- COMPANY + BUDGET ----------------------------------------------------

// Which company is this request for? Prefer the executor context if it
// carries the organization; otherwise use the user's active organization.
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
    throw new Error("Could not tell which company this video request is for.");
  }
  return organizationId;
}

function defaultMonthlyBudgetUsd(): number {
  const raw = process.env.VIDEO_DEFAULT_MONTHLY_BUDGET_USD;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return FALLBACK_MONTHLY_BUDGET_USD;
}

interface BudgetStatus {
  monthlyLimitUsd: number;
  spentThisMonthUsd: number;
  remainingUsd: number;
  resetsOn: string; // first day of next month (UTC), YYYY-MM-DD
}

async function getBudgetStatus(organizationId: string): Promise<BudgetStatus> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [override, spent] = await Promise.all([
    prisma.videoBudget.findUnique({
      where: { organizationId },
      select: { monthlyLimitUsd: true },
    }),
    prisma.videoGenerationJob.aggregate({
      _sum: { estimatedCostUsd: true },
      where: {
        organizationId,
        createdAt: { gte: monthStart },
        status: { in: ["started", "ready"] },
      },
    }),
  ]);

  const limit = override ? Number(override.monthlyLimitUsd) : defaultMonthlyBudgetUsd();
  const spentUsd = round2(Number(spent._sum.estimatedCostUsd ?? 0));

  return {
    monthlyLimitUsd: round2(limit),
    spentThisMonthUsd: spentUsd,
    remainingUsd: round2(Math.max(limit - spentUsd, 0)),
    resetsOn: nextMonth.toISOString().slice(0, 10),
  };
}

async function getVideoBudget(
  _args: unknown,
  ctx: MinimalCtx
) {
  const organizationId = await resolveOrganizationId(ctx);
  const budget = await getBudgetStatus(organizationId);
  return {
    ...budget,
    note: `This company can spend up to $${budget.monthlyLimitUsd} per month on AI video generation. $${budget.remainingUsd} remains until ${budget.resetsOn}. Estimates use Google's published per-second prices.`,
  };
}

// The job id is stored only as a SHA-256 hash, so the database never holds a
// usable Google identifier.
function hashJobId(jobId: string): string {
  return createHash("sha256").update(jobId).digest("hex");
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

  const organizationId = await resolveOrganizationId(ctx);
  const budget = await getBudgetStatus(organizationId);

  // Over this company's monthly budget: do not start (and do not ask the
  // user to approve something that cannot run).
  if (estimatedCostUsd > budget.remainingUsd + 1e-9) {
    return {
      started: false,
      overBudget: true,
      estimatedCostUsd,
      ...budget,
      message: `Not started. This video would cost about $${estimatedCostUsd}, but only $${budget.remainingUsd} remains of this company's $${budget.monthlyLimitUsd} monthly video budget (it resets on ${budget.resetsOn}). Tell the user. Suggest a cheaper quality ('lite'), a shorter length, or waiting until the budget resets. The platform admin can raise a company's limit.`,
    };
  }

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
      ...budget,
      message: `Not started. Tell the user the description you plan to use and that this will cost roughly $${estimatedCostUsd} (${durationSeconds}s, ${quality} quality, 720p). It counts against this company's monthly video budget: $${budget.remainingUsd} of $${budget.monthlyLimitUsd} remains this month. Then ask whether to go ahead. Only call generate_video again with userApprovedCost=true after they clearly say yes.`,
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

  // Record the spend against this company's monthly budget.
  try {
    await prisma.videoGenerationJob.create({
      data: {
        organizationId,
        requestedByUserId: ctx.userId,
        jobHash: hashJobId(jobId),
        model,
        quality,
        durationSeconds,
        estimatedCostUsd,
        status: "started",
      },
    });
  } catch (err) {
    // The video has already started; do not fail the request, but make the
    // missing record visible in the server logs.
    console.error("Failed to record video generation usage:", err);
  }

  const remainingAfter = round2(Math.max(budget.remainingUsd - estimatedCostUsd, 0));

  return {
    started: true,
    jobId,
    model,
    quality,
    aspectRatio,
    durationSeconds,
    resolution: "720p",
    estimatedCostUsd,
    remainingBudgetUsd: remainingAfter,
    note: "Video generation usually takes 1 to 6 minutes. Give the user this jobId exactly as written and tell them to ask you to check on the video in a minute or two.",
  };
}

// -- CHECK A VIDEO JOB ---------------------------------------------------

const JOB_ID_PATTERN = /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+$/;
const FILE_ID_PATTERN = /files\/([A-Za-z0-9_-]+)/;

const NOT_FOUND_NOTE =
  "Google has no record of that job. It may have expired (jobs and videos are kept for about 2 days) or the jobId is wrong.";

async function checkVideoStatus(args: { jobId: string }, ctx: MinimalCtx) {
  const jobId = (args.jobId ?? "").trim();
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      "That is not a valid video jobId. It looks like models/<model>/operations/<id> and comes from generate_video. Ask the user for it if it is not in the conversation."
    );
  }

  const organizationId = await resolveOrganizationId(ctx);
  const jobHash = hashJobId(jobId);

  // A company can only check on its own videos.
  const job = await prisma.videoGenerationJob.findUnique({
    where: { jobHash },
    select: { organizationId: true, status: true },
  });
  if (job && job.organizationId !== organizationId) {
    return { status: "not_found", note: NOT_FOUND_NOTE };
  }

  const setJobStatus = async (status: "ready" | "failed" | "blocked") => {
    if (!job || job.status === status) return;
    try {
      await prisma.videoGenerationJob.updateMany({
        where: { jobHash, organizationId },
        data: { status },
      });
    } catch (err) {
      console.error("Failed to update video generation usage status:", err);
    }
  };

  const key = requireGeminiKey();
  const res = await fetch(`${GEMINI_API}/${jobId}`, {
    headers: { "x-goog-api-key": key },
  });
  if (res.status === 404) {
    return { status: "not_found", note: NOT_FOUND_NOTE };
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
    await setJobStatus("failed");
    return {
      status: "failed",
      error: data.error.message ?? "Video generation failed.",
      note: "A failed video is not charged against the company's monthly budget.",
    };
  }

  const response = data.response?.generateVideoResponse;
  const samples: unknown[] = response?.generatedSamples ?? [];

  if (samples.length === 0) {
    await setJobStatus("blocked");
    return {
      status: "blocked",
      reasons: response?.raiMediaFilteredReasons ?? [],
      note: "Google's safety filters blocked this video, so nothing was generated and there is no charge (it does not count against the monthly budget). Suggest rewording the description.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uri: string | undefined = (samples[0] as any)?.video?.uri;
  const fileId = uri ? FILE_ID_PATTERN.exec(uri)?.[1] : undefined;
  if (!fileId) {
    await setJobStatus("failed");
    return {
      status: "failed",
      error: "The video finished but Google returned no downloadable file.",
    };
  }

  await setJobStatus("ready");
  return {
    status: "ready",
    fileId,
    previewUrl: `${resolveAppBaseUrl()}/api/assistant/video?f=${fileId}`,
    note: "The video is ready. Give the user the previewUrl (they must be signed in to the app to open it) and the fileId. Google keeps the file for about 2 days. If they want it on YouTube, offer upload_youtube_video with this fileId as geminiFileId.",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VideoExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const VIDEO_TOOL_EXECUTORS: Record<string, VideoExecutorFn> = {
  generate_video: generateVideo,
  check_video_status: checkVideoStatus,
  get_video_budget: getVideoBudget,
  // Confirm-gated YouTube upload (see youtube-upload.ts)
  ...UPLOAD_TOOL_EXECUTORS,
};

// generate_video and check_video_status are marked read-only so they run
// inline without a Confirm card (the confirm flow cannot carry a job id
// between turns). Cost control is done in the conversation and on the server
// instead: generate_video refuses to start unless the user has approved the
// estimated cost AND the company has enough monthly video budget left.
export const VIDEO_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "generate_video",
    description:
      "Start generating a short AI video (4 to 8 seconds, with native audio) from a text description, using Google's Veo model. This costs real money (about $0.05 per second for quality 'lite', $0.10 for 'fast' (default), $0.40 for 'standard'; an 8 second 'fast' video is about $0.80) and counts against the company's monthly video budget; if the budget is too low the tool refuses and says so. ALWAYS first tell the user the exact description you plan to use and the estimated cost, and ask whether to go ahead; only after they clearly say yes, call this with userApprovedCost=true. Generation takes 1 to 6 minutes, so this only STARTS the job and returns a jobId. Give the user the jobId exactly as returned and tell them to ask you to check on it later; do not call check_video_status in the same reply. Output is 720p, landscape (16:9) or vertical (9:16, good for YouTube Shorts). Descriptions work best when they name the subject, action, style, camera movement, and any spoken lines or sounds. For still images use generate_image instead.",
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
  {
    name: "get_video_budget",
    description:
      "Show the company's AI video generation budget for this month: the monthly limit, how much has been spent, how much remains, and when it resets. Call it when the user asks about video costs, spending, or how many videos they can still make. Read-only.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  // Confirm-gated YouTube upload (see youtube-upload.ts)
  ...UPLOAD_TOOL_DEFINITIONS,
];
