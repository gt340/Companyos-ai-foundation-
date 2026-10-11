// src/lib/voice/voice-tools.ts
// AI voices through ElevenLabs: choose a STOCK voice or a CLONED voice of
// someone at the company, and generate speech from text.
//
// Uses the ELEVENLABS_API_KEY server environment variable. All companies share
// that one ElevenLabs account (the platform pays), so:
//   - a cloned voice is recorded against the company that created it
//     (cloned_voices table) and only that company can list or use it;
//   - each company has a monthly CHARACTER budget for generated speech:
//     VOICE_MONTHLY_CHARACTER_LIMIT (default 10000), counted in voice_usage_logs;
//   - each company can keep at most VOICE_MAX_CLONES_PER_COMPANY cloned
//     voices (default 3).
//
// Cloning a voice is identity-sensitive. It is limited to company owners and
// admins, always shows a Confirm card, requires the requester to confirm that
// the speaker gave WRITTEN consent, and records where that consent is kept.
// A cloned voice can be deleted at any time (delete_cloned_voice), for example
// if the speaker withdraws consent.
//
// Generated audio is saved to the requesting user's Google Drive (the Drive
// permission is already granted); the tool returns the Drive link.
//
// Registered through src/lib/integrations/registry.ts. The AssistantTool
// import is type-only, so there is no circular import with tools.ts.

import { randomUUID } from "crypto";
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

const ELEVEN_API = "https://api.elevenlabs.io/v1";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

const TTS_MODEL = "eleven_multilingual_v2";
const MAX_SAMPLE_CHARS = 1500;
const MAX_CLONE_SAMPLE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MONTHLY_CHARACTER_LIMIT = 10000;
const DEFAULT_MAX_CLONES = 3;
const VOICE_ID_PATTERN = /^[A-Za-z0-9]{10,40}$/;

function requireElevenKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set on the server, so voice features are unavailable."
    );
  }
  return key;
}

async function elevenError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const data: Json = await res.json();
    const detail = data?.detail;
    message =
      (typeof detail === "string" ? detail : detail?.message) ?? data?.message ?? fallback;
  } catch {
    // response body was not JSON - keep the fallback message
  }
  if (res.status === 401) {
    message += " (Check that ELEVENLABS_API_KEY is valid.)";
  } else if (res.status === 429 || /quota|credit/i.test(message)) {
    message +=
      " (The platform's ElevenLabs credits or rate limit may be used up. Try again later.)";
  }
  return new Error(message);
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return fallback;
}

// -- COMPANY + PERMISSIONS ----------------------------------------------

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
    throw new Error("Could not tell which company this voice request is for.");
  }
  return organizationId;
}

// Cloning and deleting cloned voices are limited to company owners and admins.
async function assertCanManageVoices(userId: string, organizationId: string): Promise<void> {
  const membership = await prisma.membership.findFirst({
    where: { userId, organizationId, isActive: true },
    select: { role: { select: { key: true } } },
  });
  const key = membership?.role.key;
  if (key !== "OWNER" && key !== "ADMIN") {
    throw new Error("Only a company owner or admin can create or delete cloned voices.");
  }
}

// -- USAGE ---------------------------------------------------------------

interface VoiceUsage {
  monthlyCharacterLimit: number;
  usedThisMonth: number;
  remaining: number;
  resetsOn: string; // first day of next month (UTC), YYYY-MM-DD
}

async function getVoiceUsage(organizationId: string): Promise<VoiceUsage> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const sum = await prisma.voiceUsageLog.aggregate({
    _sum: { characters: true },
    where: { organizationId, createdAt: { gte: monthStart } },
  });

  const limit = numberFromEnv("VOICE_MONTHLY_CHARACTER_LIMIT", DEFAULT_MONTHLY_CHARACTER_LIMIT);
  const used = sum._sum.characters ?? 0;
  return {
    monthlyCharacterLimit: limit,
    usedThisMonth: used,
    remaining: Math.max(limit - used, 0),
    resetsOn: nextMonth.toISOString().slice(0, 10),
  };
}

// -- ELEVENLABS VOICES ---------------------------------------------------

interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string>;
}

async function fetchElevenVoices(): Promise<ElevenVoice[]> {
  const res = await fetch(`${ELEVEN_API}/voices`, {
    headers: { "xi-api-key": requireElevenKey() },
  });
  if (!res.ok) throw await elevenError(res, "Failed to load the voice list.");
  const data: Json = await res.json();
  return (data.voices ?? []) as ElevenVoice[];
}

// -- list_voices ---------------------------------------------------------

async function listVoices(_args: unknown, ctx: MinimalCtx) {
  const organizationId = await resolveOrganizationId(ctx);

  const [all, clonedRows, usage] = await Promise.all([
    fetchElevenVoices(),
    prisma.clonedVoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { elevenLabsVoiceId: true, speakerName: true, createdAt: true },
    }),
    getVoiceUsage(organizationId),
  ]);

  const stock = all
    .filter((v) => v.category === "premade")
    .slice(0, 30)
    .map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      description: v.description ?? null,
      traits: v.labels ?? {},
      previewUrl: v.preview_url ?? null,
    }));

  const cloned = clonedRows.map((r) => ({
    voiceId: r.elevenLabsVoiceId,
    speaker: r.speakerName,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    stockVoices: stock,
    clonedVoices: cloned,
    usage,
    note: "Ask the user which they want: a STOCK voice (one of the ready-made voices) or a CLONED voice of someone at the company. If they want a cloned voice that does not exist yet, create_cloned_voice needs a clean audio recording in Google Drive and the speaker's written consent.",
  };
}

// -- create_cloned_voice -------------------------------------------------

async function createClonedVoice(
  args: {
    speakerName: string;
    driveFileId: string;
    consentConfirmed?: boolean;
    consentNote?: string;
    description?: string;
  },
  ctx: MinimalCtx
) {
  const organizationId = await resolveOrganizationId(ctx);
  await assertCanManageVoices(ctx.userId, organizationId);

  const speakerName = (args.speakerName ?? "").trim();
  if (!speakerName || speakerName.length > 60) {
    throw new Error("Provide the speaker's name (1 to 60 characters).");
  }

  // Consent gate: a voice is never cloned without the requester confirming
  // the speaker gave written consent, and saying where that record is kept.
  if (args.consentConfirmed !== true) {
    throw new Error(
      `Not created. A voice can only be cloned with the speaker's WRITTEN consent. Ask the user to confirm that ${speakerName} has agreed in writing to having their voice cloned and used by the company, then try again with consentConfirmed=true.`
    );
  }
  const consentNote = (args.consentNote ?? "").trim();
  if (consentNote.length < 10) {
    throw new Error(
      "Not created. Ask the user where the speaker's written consent is kept (for example, 'signed form saved in the HR folder in Drive') and pass it as consentNote."
    );
  }

  const driveFileId = String(args.driveFileId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{5,100}$/.test(driveFileId)) {
    throw new Error("Provide the Google Drive file ID of the voice recording.");
  }

  const maxClones = numberFromEnv("VOICE_MAX_CLONES_PER_COMPANY", DEFAULT_MAX_CLONES);
  const existing = await prisma.clonedVoice.count({ where: { organizationId } });
  if (existing >= maxClones) {
    throw new Error(
      `This company already has ${existing} cloned voice(s), the maximum is ${maxClones}. Delete one with delete_cloned_voice first, or ask the platform admin to raise the limit.`
    );
  }

  const googleToken = await getValidGoogleAccessToken(ctx.userId);
  if (!googleToken) {
    throw new Error(
      "No Google account is connected yet. Connect one at /integrations so the voice recording can be read from Google Drive."
    );
  }

  // Read the recording from the user's Drive.
  const metaRes = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?fields=id,name,mimeType,size`,
    { headers: { Authorization: `Bearer ${googleToken}` } }
  );
  if (!metaRes.ok) throw new Error("Could not find that file in Google Drive.");
  const meta: Json = await metaRes.json();

  const mimeType: string = meta.mimeType ?? "";
  if (!mimeType.startsWith("audio/")) {
    throw new Error(
      `That Drive file ("${meta.name}") is not an audio file (type: ${mimeType || "unknown"}). Use a clean recording such as .mp3, .m4a or .wav.`
    );
  }
  const size = meta.size ? Number(meta.size) : 0;
  if (size > MAX_CLONE_SAMPLE_BYTES) {
    throw new Error("That recording is too large (limit 10 MB). Use a shorter or compressed file.");
  }

  const fileRes = await fetch(`${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${googleToken}` },
  });
  if (!fileRes.ok) throw new Error("Failed to download the voice recording from Google Drive.");
  const audio = new Uint8Array(await fileRes.arrayBuffer());

  // Create the voice at ElevenLabs.
  const form = new FormData();
  form.append("name", `${speakerName} (CompanyOS)`);
  form.append(
    "description",
    (args.description ?? `Cloned voice of ${speakerName}, created with written consent.`).slice(0, 500)
  );
  form.append("remove_background_noise", "true");
  form.append("files", new Blob([audio], { type: mimeType }), String(meta.name ?? "sample"));

  const cloneRes = await fetch(`${ELEVEN_API}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": requireElevenKey() },
    body: form,
  });
  if (!cloneRes.ok) throw await elevenError(cloneRes, "ElevenLabs could not clone that voice.");
  const created: Json = await cloneRes.json();
  const voiceId: string | undefined = created?.voice_id;
  if (!voiceId) throw new Error("ElevenLabs did not return a voice id.");

  // Record it against this company (and the consent details).
  try {
    await prisma.clonedVoice.create({
      data: {
        organizationId,
        createdByUserId: ctx.userId,
        elevenLabsVoiceId: voiceId,
        speakerName,
        consentNote,
      },
    });
  } catch (err) {
    // Do not leave an unrecorded clone behind.
    await fetch(`${ELEVEN_API}/voices/${voiceId}`, {
      method: "DELETE",
      headers: { "xi-api-key": requireElevenKey() },
    }).catch(() => undefined);
    throw new Error(
      `The voice was cloned but could not be saved, so it was removed again: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
  }

  return {
    created: true,
    voiceId,
    speaker: speakerName,
    note: "The cloned voice is ready and belongs to this company only. Use its voiceId with generate_voice_sample. It can be deleted at any time with delete_cloned_voice.",
  };
}

// -- delete_cloned_voice -------------------------------------------------

async function deleteClonedVoice(args: { voiceId: string }, ctx: MinimalCtx) {
  const organizationId = await resolveOrganizationId(ctx);
  await assertCanManageVoices(ctx.userId, organizationId);

  const voiceId = String(args.voiceId ?? "").trim();
  if (!VOICE_ID_PATTERN.test(voiceId)) throw new Error("That is not a valid voice id.");

  const row = await prisma.clonedVoice.findFirst({
    where: { organizationId, elevenLabsVoiceId: voiceId },
    select: { speakerName: true },
  });
  if (!row) throw new Error("No cloned voice with that id belongs to this company.");

  const res = await fetch(`${ELEVEN_API}/voices/${voiceId}`, {
    method: "DELETE",
    headers: { "xi-api-key": requireElevenKey() },
  });
  // 404 means it is already gone at ElevenLabs; still remove our record.
  if (!res.ok && res.status !== 404) {
    throw await elevenError(res, "ElevenLabs could not delete that voice.");
  }

  await prisma.clonedVoice.deleteMany({ where: { organizationId, elevenLabsVoiceId: voiceId } });

  return { deleted: true, speaker: row.speakerName, voiceId };
}

// -- generate_voice_sample -----------------------------------------------

async function generateVoiceSample(
  args: { text: string; voiceId: string },
  ctx: MinimalCtx
) {
  const text = (args.text ?? "").trim();
  if (!text) throw new Error("Provide the text to speak.");
  if (text.length > MAX_SAMPLE_CHARS) {
    throw new Error(
      `That text is too long for a sample (${text.length} characters; limit ${MAX_SAMPLE_CHARS}). Use a shorter passage.`
    );
  }

  const voiceId = String(args.voiceId ?? "").trim();
  if (!VOICE_ID_PATTERN.test(voiceId)) {
    throw new Error("Provide a voice id from list_voices.");
  }

  const organizationId = await resolveOrganizationId(ctx);

  // The voice must be a stock voice, or a cloned voice owned by THIS company.
  const clonedRow = await prisma.clonedVoice.findFirst({
    where: { organizationId, elevenLabsVoiceId: voiceId },
    select: { speakerName: true },
  });
  let voiceKind: "stock" | "cloned";
  let voiceName: string;
  if (clonedRow) {
    voiceKind = "cloned";
    voiceName = clonedRow.speakerName;
  } else {
    const stock = (await fetchElevenVoices()).find(
      (v) => v.voice_id === voiceId && v.category === "premade"
    );
    if (!stock) {
      throw new Error(
        "That voice is not available to this company. Use list_voices to see the stock voices and this company's cloned voices."
      );
    }
    voiceKind = "stock";
    voiceName = stock.name;
  }

  const usage = await getVoiceUsage(organizationId);
  if (text.length > usage.remaining) {
    throw new Error(
      `Not generated. This company has ${usage.remaining} of its ${usage.monthlyCharacterLimit} monthly voice characters left (resets ${usage.resetsOn}), and this text is ${text.length}. Use shorter text or wait for the reset. The platform admin can raise the limit.`
    );
  }

  const googleToken = await getValidGoogleAccessToken(ctx.userId);
  if (!googleToken) {
    throw new Error(
      "No Google account is connected yet. Connect one at /integrations so the audio can be saved to Google Drive."
    );
  }

  // Generate the speech.
  const ttsRes = await fetch(
    `${ELEVEN_API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": requireElevenKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
    }
  );
  if (!ttsRes.ok) throw await elevenError(ttsRes, "Failed to generate the speech.");
  const audio = new Uint8Array(await ttsRes.arrayBuffer());

  // Characters are spent as soon as the speech exists, so count them now.
  try {
    await prisma.voiceUsageLog.create({
      data: {
        organizationId,
        requestedByUserId: ctx.userId,
        characters: text.length,
        voiceKind,
      },
    });
  } catch (err) {
    console.error("Failed to record voice usage:", err);
  }

  // Save the audio to the user's Google Drive.
  const boundary = `companyos-${randomUUID()}`;
  const fileName = `Voice sample - ${voiceName} - ${new Date().toISOString().slice(0, 10)}.mp3`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name: fileName, mimeType: "audio/mpeg" })}\r\n` +
      `--${boundary}\r\nContent-Type: audio/mpeg\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = new Uint8Array(Buffer.concat([head, Buffer.from(audio), tail]));

  const uploadRes = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${googleToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!uploadRes.ok) {
    throw new Error(
      "The speech was generated but could not be saved to Google Drive. The characters were still used."
    );
  }
  const saved: Json = await uploadRes.json();

  return {
    created: true,
    voiceKind,
    voiceName,
    characters: text.length,
    remainingCharactersThisMonth: Math.max(usage.remaining - text.length, 0),
    driveFileId: saved.id,
    fileName: saved.name,
    link: saved.webViewLink ?? null,
    note: "The audio was saved to the user's Google Drive. Give them the link.",
  };
}

// -- REGISTRATION --------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VoiceExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const VOICE_TOOL_EXECUTORS: Record<string, VoiceExecutorFn> = {
  list_voices: listVoices,
  create_cloned_voice: createClonedVoice,
  delete_cloned_voice: deleteClonedVoice,
  generate_voice_sample: generateVoiceSample,
};

// Identity-sensitive or spending actions: these always go through the Confirm card.
export const VOICE_MUTATING_TOOL_NAMES = [
  "create_cloned_voice",
  "delete_cloned_voice",
  "generate_voice_sample",
];

export const VOICE_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "list_voices",
    description:
      "List the voices available for AI speech: STOCK voices (ready-made, shared) and the CLONED voices of people at this company, plus this company's monthly voice-character budget. Call it whenever the user wants speech, narration, or a presenter voice, then ask them to choose: a stock voice or a cloned voice of someone at the company. Read-only.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "generate_voice_sample",
    description:
      "Turn text into spoken audio with a chosen voice and save the MP3 to the user's Google Drive. ALWAYS ask the user whether they want a stock voice or a cloned voice first (use list_voices to show the options), and read the text back to them before generating. It uses the company's monthly voice-character budget (max 1500 characters per sample) and always requires explicit confirmation. A cloned voice can only be used by the company that created it.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The words to speak (max 1500 characters)." },
        voiceId: { type: "string", description: "A voiceId from list_voices (stock or cloned)." },
      },
      required: ["text", "voiceId"],
    },
  },
  {
    name: "create_cloned_voice",
    description:
      "Create a cloned AI voice of a person at the company from a clean voice recording in Google Drive (driveFileId, from list_drive_files; an audio file such as .mp3, .m4a or .wav, ideally at least one minute of clear speech, under 10 MB). Only company owners and admins can do this, and it always requires explicit confirmation. You MUST first ask the user to confirm that the speaker has given WRITTEN consent to having their voice cloned and used by the company, and ask where that written consent is kept; pass consentConfirmed=true and a consentNote only after they say so. Never clone a celebrity, a public figure, or anyone without consent. A company can have only a few cloned voices.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        speakerName: { type: "string", description: "The name of the person whose voice is cloned." },
        driveFileId: { type: "string", description: "Google Drive file ID of the audio recording." },
        consentConfirmed: {
          type: "boolean",
          description: "True ONLY if the user confirmed the speaker gave written consent.",
        },
        consentNote: {
          type: "string",
          description:
            "Where the written consent is kept, in the user's words (for example 'signed form in the HR folder in Drive').",
        },
        description: { type: "string", description: "Optional short description of the voice." },
      },
      required: ["speakerName", "driveFileId", "consentConfirmed", "consentNote"],
    },
  },
  {
    name: "delete_cloned_voice",
    description:
      "Delete one of this company's cloned voices (for example if the speaker withdraws consent). Only company owners and admins can do this, it cannot be undone, and it always requires explicit confirmation.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        voiceId: { type: "string", description: "The voiceId of the cloned voice (from list_voices)." },
      },
      required: ["voiceId"],
    },
  },
];
