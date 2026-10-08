// src/lib/google/drive-tools.ts
// Read-only Google Drive tools, built on getValidGoogleAccessToken.
// Requires the Google Drive API to be enabled in the Google Cloud project
// and the user to have granted the drive scope (already requested at connect).
//
// Kept separate from gmail-calendar-tools.ts. Executors are merged into
// GOOGLE_TOOL_EXECUTORS there; definitions are spread into ASSISTANT_TOOLS
// in tools.ts. The AssistantTool import is type-only (erased at compile
// time), so there is no circular-import problem with tools.ts.

import type { AssistantTool } from "../assistant/tools";
import { getValidGoogleAccessToken } from "./token";

interface MinimalCtx {
  userId: string;
}

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DEFAULT_MAX_CHARS = 20000;
const HARD_MAX_CHARS = 50000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

async function requireGoogleToken(userId: string): Promise<string> {
  const token = await getValidGoogleAccessToken(userId);
  if (!token) {
    throw new Error(
      "No Google account is connected yet. Connect one at /integrations before using Google Drive."
    );
  }
  return token;
}

async function driveError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const data = await res.json();
    message = data?.error?.message ?? fallback;
  } catch {
    // response body was not JSON — keep the fallback message
  }
  if (
    res.status === 403 &&
    /has not been used|is disabled|accessNotConfigured/i.test(message)
  ) {
    message +=
      " (Enable the Google Drive API in the Google Cloud project: APIs & Services, Library, Google Drive API.)";
  }
  return new Error(message);
}

// Escape a value for use inside single quotes in a Drive search query.
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── LIST / SEARCH ────────────────────────────────────────────────────

async function listDriveFiles(
  args: { searchText?: string; maxResults?: number },
  ctx: MinimalCtx
) {
  const token = await requireGoogleToken(ctx.userId);
  const pageSize = Math.min(Math.max(args.maxResults ?? 10, 1), 25);

  const clauses = ["trashed = false"];
  const text = args.searchText?.trim();
  if (text) {
    const safe = escapeDriveQueryValue(text);
    clauses.push(`(name contains '${safe}' or fullText contains '${safe}')`);
  }

  const params = new URLSearchParams({
    pageSize: String(pageSize),
    orderBy: "modifiedTime desc",
    q: clauses.join(" and "),
    fields:
      "files(id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName,emailAddress))",
  });

  const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await driveError(res, "Failed to list Google Drive files.");
  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const files = (data.files ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    sizeBytes: f.size ? Number(f.size) : null,
    link: f.webViewLink ?? null,
    owner: f.owners?.[0]?.emailAddress ?? null,
  }));

  if (files.length === 0) {
    return {
      files: [],
      count: 0,
      note: text
        ? "No Drive files found matching that search."
        : "No files found in Google Drive.",
    };
  }
  return { files, count: files.length };
}

// ── READ ─────────────────────────────────────────────────────────────

async function readDriveFile(
  args: { fileId: string; maxChars?: number },
  ctx: MinimalCtx
) {
  const token = await requireGoogleToken(ctx.userId);
  const maxChars = Math.min(
    Math.max(args.maxChars ?? DEFAULT_MAX_CHARS, 500),
    HARD_MAX_CHARS
  );
  const fileId = encodeURIComponent(args.fileId);
  const headers = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,webViewLink`,
    { headers }
  );
  if (!metaRes.ok) throw await driveError(metaRes, "Could not find that Drive file.");
  const meta = await metaRes.json();
  const mime: string = meta.mimeType;

  let contentRes: Response;
  if (mime === "application/vnd.google-apps.document") {
    contentRes = await fetch(
      `${DRIVE_API}/files/${fileId}/export?mimeType=text/plain`,
      { headers }
    );
  } else if (mime === "application/vnd.google-apps.presentation") {
    contentRes = await fetch(
      `${DRIVE_API}/files/${fileId}/export?mimeType=text/plain`,
      { headers }
    );
  } else if (mime === "application/vnd.google-apps.spreadsheet") {
    // CSV export only returns the first sheet.
    contentRes = await fetch(
      `${DRIVE_API}/files/${fileId}/export?mimeType=text/csv`,
      { headers }
    );
  } else if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml"
  ) {
    if (meta.size && Number(meta.size) > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `This file is too large to read here (${meta.size} bytes; limit ${MAX_DOWNLOAD_BYTES}).`
      );
    }
    contentRes = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers });
  } else {
    return {
      id: meta.id,
      name: meta.name,
      mimeType: mime,
      link: meta.webViewLink ?? null,
      readable: false,
      note: "This file type can't be read as text here (for example PDFs, Word files, images, or folders). Open it via the link, or upload it to the Knowledge Base to make it searchable.",
    };
  }

  if (!contentRes.ok) {
    throw await driveError(contentRes, "Failed to read that Drive file.");
  }

  const fullText = await contentRes.text();
  const truncated = fullText.length > maxChars;

  return {
    id: meta.id,
    name: meta.name,
    mimeType: mime,
    modifiedTime: meta.modifiedTime,
    link: meta.webViewLink ?? null,
    readable: true,
    truncated,
    totalChars: fullText.length,
    content: truncated ? fullText.slice(0, maxChars) : fullText,
    ...(mime === "application/vnd.google-apps.spreadsheet"
      ? { note: "Only the first sheet of this spreadsheet is included." }
      : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DriveExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const DRIVE_TOOL_EXECUTORS: Record<string, DriveExecutorFn> = {
  list_drive_files: listDriveFiles,
  read_drive_file: readDriveFile,
};

// Both Drive tools are read-only, so they run immediately with no Confirm card.
export const DRIVE_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "list_drive_files",
    description:
      "List or search the user's Google Drive files (name, type, last modified, link), most recently modified first. Pass searchText to search by file name or file contents; omit it to see the latest files. Returns file IDs that can be passed to read_drive_file. Requires the user to have connected their Google account at /integrations. Read-only, so it runs immediately without confirmation.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        searchText: {
          type: "string",
          description:
            "Optional text to search for in file names and contents, e.g. 'budget' or 'Q3 report'.",
        },
        maxResults: {
          type: "number",
          description: "Max results (1-25). Defaults to 10.",
        },
      },
    },
  },
  {
    name: "read_drive_file",
    description:
      "Read the text content of a Google Drive file by its ID (get IDs from list_drive_files). Works for Google Docs, Google Slides (text), Google Sheets (first sheet as CSV), and plain-text files such as .txt, .md, .csv, and .json. Cannot read PDFs, Word/Excel files, images, or folders — it will say so. Long files are truncated. Read-only, so it runs immediately without confirmation.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The Google Drive file ID.",
        },
        maxChars: {
          type: "number",
          description:
            "Max characters of content to return. Defaults to 20000, capped at 50000.",
        },
      },
      required: ["fileId"],
    },
  },
];
