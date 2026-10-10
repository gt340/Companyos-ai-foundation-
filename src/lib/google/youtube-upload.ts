// src/lib/google/youtube-upload.ts
// Upload a video to the user's YouTube channel (YouTube Data API videos.insert).
//
// The video can come from:
//   - a video the assistant generated with Veo (geminiFileId, from
//     check_video_status), or
//   - a video file in the user's Google Drive (driveFileId, from
//     list_drive_files).
//
// This is a real, public-facing action, so it is a MUTATING tool: the chat
// shows a Confirm card and nothing is uploaded until the user taps Confirm.
// It defaults to privacy "private".
//
// Requirements:
//  - YouTube Data API v3 enabled in the Google Cloud project.
//  - The connected Google account must have granted the youtube.upload scope
//    (requested by /api/auth/google/connect; accounts connected before that
//    scope was added must disconnect and reconnect).
//  - Google restricts videos uploaded through the API from unverified API
//    projects (created after July 2020) to private until the project passes a
//    YouTube API Services compliance audit. Uploads work, but they may stay
//    private until then.
//  - videos.insert costs about 1,600 of the default 10,000 daily quota units.
//
// Executors/definitions are registered via video-tools.ts. The AssistantTool
// import is type-only, so there is no circular import.

import type { AssistantTool } from "../assistant/tools";
import { prisma } from "@/lib/prisma";
import { getValidGoogleAccessToken } from "./token";

interface MinimalCtx {
  userId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const YT_UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3/videos";

const SCOPE_UPLOAD = "https://www.googleapis.com/auth/youtube.upload";

const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const NOT_CONNECTED =
  "No Google account is connected yet. Connect one at /integrations before uploading to YouTube.";

async function requireUploadToken(userId: string): Promise<string> {
  const connection = await prisma.googleConnection.findUnique({
    where: { userId },
    select: { scopes: true },
  });
  if (!connection) throw new Error(NOT_CONNECTED);

  if (!connection.scopes.includes(SCOPE_UPLOAD)) {
    throw new Error(
      "Your connected Google account has not granted YouTube upload permission yet. Disconnect and reconnect your Google account at /integrations, and approve the YouTube upload permission on the Google screen."
    );
  }

  const token = await getValidGoogleAccessToken(userId);
  if (!token) throw new Error(NOT_CONNECTED);
  return token;
}

async function googleError(res: Response, fallback: string): Promise<Error> {
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
    message +=
      " (Enable the YouTube Data API v3 in the Google Cloud project: APIs & Services, Library.)";
  }
  if (res.status === 403 && /quota/i.test(message)) {
    message += " (The daily YouTube API quota may be used up; it resets daily.)";
  }
  return new Error(message);
}

interface SourceVideo {
  bytes: Uint8Array;
  mimeType: string;
  origin: "gemini" | "drive";
}

async function downloadFromGemini(fileId: string): Promise<SourceVideo> {
  if (!FILE_ID_PATTERN.test(fileId)) {
    throw new Error("That is not a valid generated-video file id.");
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set on the server, so generated videos cannot be fetched.");
  }

  const res = await fetch(`${GEMINI_API}/files/${fileId}:download?alt=media`, {
    headers: { "x-goog-api-key": key },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "That generated video was not found. Generated videos expire after about 2 days."
        : "Failed to fetch the generated video from Gemini."
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error("That video is too large to upload from here.");
  }
  return { bytes, mimeType: "video/mp4", origin: "gemini" };
}

async function downloadFromDrive(fileId: string, token: string): Promise<SourceVideo> {
  if (!FILE_ID_PATTERN.test(fileId)) {
    throw new Error("That is not a valid Google Drive file id.");
  }
  const headers = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`,
    { headers }
  );
  if (!metaRes.ok) throw await googleError(metaRes, "Could not find that Drive file.");
  const meta: Json = await metaRes.json();

  const mimeType: string = meta.mimeType ?? "";
  if (!mimeType.startsWith("video/")) {
    throw new Error(
      `That Drive file ("${meta.name}") is not a video (type: ${mimeType || "unknown"}).`
    );
  }
  const size = meta.size ? Number(meta.size) : 0;
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `That video is too large to upload from here (${Math.round(size / 1024 / 1024)} MB; limit ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`
    );
  }

  const fileRes = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers,
  });
  if (!fileRes.ok) throw await googleError(fileRes, "Failed to download that Drive video.");
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error("That video is too large to upload from here.");
  }
  return { bytes, mimeType, origin: "drive" };
}

async function uploadYouTubeVideo(
  args: {
    title: string;
    description?: string;
    geminiFileId?: string;
    driveFileId?: string;
    tags?: string[];
    privacy?: string;
    madeForKids?: boolean;
    aiGenerated?: boolean;
  },
  ctx: MinimalCtx
) {
  const title = (args.title ?? "").trim();
  if (!title) throw new Error("A video title is required.");
  if (title.length > 100) throw new Error("The title must be 100 characters or fewer.");

  const description = (args.description ?? "").trim();
  if (description.length > 5000) {
    throw new Error("The description must be 5000 characters or fewer.");
  }

  const hasGemini = Boolean(args.geminiFileId);
  const hasDrive = Boolean(args.driveFileId);
  if (hasGemini === hasDrive) {
    throw new Error(
      "Provide exactly one video source: geminiFileId (a video the assistant generated) or driveFileId (a video file in Google Drive)."
    );
  }

  const privacy =
    args.privacy === "public" || args.privacy === "unlisted" ? args.privacy : "private";

  const tags = (Array.isArray(args.tags) ? args.tags : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 15);

  const token = await requireUploadToken(ctx.userId);

  const source = hasGemini
    ? await downloadFromGemini(args.geminiFileId as string)
    : await downloadFromDrive(args.driveFileId as string, token);

  // Disclose AI-generated video by default when the assistant generated it.
  const containsSyntheticMedia =
    typeof args.aiGenerated === "boolean" ? args.aiGenerated : source.origin === "gemini";

  const metadata = {
    snippet: {
      title,
      description,
      ...(tags.length > 0 ? { tags } : {}),
      categoryId: "22",
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: args.madeForKids === true,
      containsSyntheticMedia,
    },
  };

  // Step 1: start a resumable upload session.
  const startRes = await fetch(
    `${YT_UPLOAD_API}?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(source.bytes.length),
        "X-Upload-Content-Type": source.mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!startRes.ok) throw await googleError(startRes, "YouTube refused to start the upload.");

  const sessionUrl = startRes.headers.get("location");
  if (!sessionUrl) throw new Error("YouTube did not return an upload address.");

  // Step 2: send the video bytes.
  const putRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": source.mimeType,
    },
    body: source.bytes,
  });
  if (!putRes.ok) throw await googleError(putRes, "The video upload to YouTube failed.");

  const video: Json = await putRes.json();
  const videoId: string = video.id;
  const actualPrivacy: string = video.status?.privacyStatus ?? privacy;

  return {
    uploaded: true,
    videoId,
    title,
    requestedPrivacy: privacy,
    privacy: actualPrivacy,
    link: `https://www.youtube.com/watch?v=${videoId}`,
    studioLink: `https://studio.youtube.com/video/${videoId}/edit`,
    markedAsAiGenerated: containsSyntheticMedia,
    ...(actualPrivacy !== privacy
      ? {
          note: "YouTube kept this video private even though a different privacy was requested. YouTube locks API uploads from unaudited projects to private until the project passes its API compliance audit.",
        }
      : {}),
  };
}

export const UPLOAD_TOOL_NAMES = ["upload_youtube_video"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UploadExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const UPLOAD_TOOL_EXECUTORS: Record<string, UploadExecutorFn> = {
  upload_youtube_video: uploadYouTubeVideo,
};

// Mutating: always goes through the Confirm card before anything is uploaded.
export const UPLOAD_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "upload_youtube_video",
    description:
      "Upload a video to the user's YouTube channel. The video comes from EITHER a video you generated (geminiFileId, the fileId returned by check_video_status) OR a video file in the user's Google Drive (driveFileId, from list_drive_files). Provide exactly one source. This is a real external action and always requires explicit confirmation before it happens. Before calling it, agree the title and description with the user. It defaults to privacy 'private'; only use 'unlisted' or 'public' if the user asks. If the video is aimed at children, set madeForKids true (ask if unsure). Videos you generated are automatically labeled as AI-generated. Note: YouTube may keep API uploads private until this app passes Google's API compliance audit.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Video title (max 100 characters)." },
        description: { type: "string", description: "Video description (max 5000 characters)." },
        geminiFileId: {
          type: "string",
          description: "The fileId of a video generated with generate_video (from check_video_status). Use this OR driveFileId.",
        },
        driveFileId: {
          type: "string",
          description: "The Google Drive file ID of a video file (from list_drive_files). Use this OR geminiFileId.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags (up to 15).",
        },
        privacy: {
          type: "string",
          description: "'private' (default), 'unlisted', or 'public'.",
        },
        madeForKids: {
          type: "boolean",
          description: "True if the video is made for children. Defaults to false.",
        },
        aiGenerated: {
          type: "boolean",
          description: "Whether to mark the video as AI-generated/synthetic. Defaults to true for generated videos and false for Drive videos.",
        },
      },
      required: ["title"],
    },
  },
];
