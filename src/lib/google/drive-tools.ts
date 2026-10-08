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
const MAX_TEXT_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BINARY_DOWNLOAD_BYTES = 10 * 1024 * 1024;

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const MIME_PDF = "application/pdf";
const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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
    // response body was not JSON - keep the fallback message
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

// -- LIST / SEARCH ------------------------------------------------------

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

// -- READ ---------------------------------------------------------------

type BinaryKind = "pdf" | "word" | "excel" | "powerpoint";

function binaryKindFor(mime: string): BinaryKind | null {
  switch (mime) {
    case MIME_PDF:
      return "pdf";
    case MIME_DOCX:
      return "word";
    case MIME_XLSX:
      return "excel";
    case MIME_PPTX:
      return "powerpoint";
    default:
      return null;
  }
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  fallback: string
): Promise<string> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw await driveError(res, fallback);
  return res.text();
}

// Reuses the same extractors the Knowledge Base upload pipeline uses.
// Imported lazily so a problem loading these libraries can never affect
// the rest of the assistant, only reading binary Drive files.
async function extractBinary(kind: BinaryKind, buffer: Buffer): Promise<string> {
  const extract = await import("../knowledge/extract-text");
  const result =
    kind === "pdf"
      ? await extract.extractFromPdf(buffer)
      : kind === "word"
        ? await extract.extractFromWord(buffer)
        : kind === "excel"
          ? await extract.extractFromExcel(buffer)
          : await extract.extractFromPowerPoint(buffer);

  if ("error" in result) {
    throw new Error(`Could not read that file's contents: ${result.error}`);
  }
  return extract.cleanText(result.text);
}

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
  const sizeBytes = meta.size ? Number(meta.size) : null;

  let fullText: string;
  let note: string | undefined;

  if (mime === GOOGLE_DOC || mime === GOOGLE_SLIDES) {
    fullText = await fetchText(
      `${DRIVE_API}/files/${fileId}/export?mimeType=text/plain`,
      headers,
      "Failed to read that Drive file."
    );
  } else if (mime === GOOGLE_SHEET) {
    // CSV export only returns the first sheet.
    fullText = await fetchText(
      `${DRIVE_API}/files/${fileId}/export?mimeType=text/csv`,
      headers,
      "Failed to read that Drive file."
    );
    note = "Only the first sheet of this spreadsheet is included.";
  } else if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml"
  ) {
    if (sizeBytes !== null && sizeBytes > MAX_TEXT_DOWNLOAD_BYTES) {
      throw new Error(
        `This file is too large to read here (${sizeBytes} bytes; limit ${MAX_TEXT_DOWNLOAD_BYTES}).`
      );
    }
    fullText = await fetchText(
      `${DRIVE_API}/files/${fileId}?alt=media`,
      headers,
      "Failed to read that Drive file."
    );
  } else {
    const kind = binaryKindFor(mime);
    if (!kind) {
      return {
        id: meta.id,
        name: meta.name,
        mimeType: mime,
        link: meta.webViewLink ?? null,
        readable: false,
        note: "This file type can't be read as text here (supported: Google Docs, Sheets, Slides, PDF, Word .docx, Excel .xlsx, PowerPoint .pptx, and plain-text files). Older .doc/.xls/.ppt files, images, and folders are not supported. Open it via the link, or convert it to a Google Doc.",
      };
    }
    if (sizeBytes !== null && sizeBytes > MAX_BINARY_DOWNLOAD_BYTES) {
      throw new Error(
        `This file is too large to read here (${sizeBytes} bytes; limit ${MAX_BINARY_DOWNLOAD_BYTES}).`
      );
    }
    const fileRes = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers });
    if (!fileRes.ok) throw await driveError(fileRes, "Failed to download that Drive file.");
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    fullText = await extractBinary(kind, buffer);

    if (kind === "pdf" && fullText.trim() === "") {
      return {
        id: meta.id,
        name: meta.name,
        mimeType: mime,
        link: meta.webViewLink ?? null,
        readable: false,
        note: "This PDF has no extractable text (it is probably a scan or image-only PDF), so it can't be read here.",
      };
    }
  }

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
    ...(note ? { note } : {}),
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
      "List or search the user's Google Drive files (name, type, last modified, link), most recently modified first. Pass searchText to search by file name or file contents; omit it to see the latest files. Returns file IDs that can be passed to read_drive_file. Call this immediately whenever the user asks about their Drive files - do not tell the user to connect their account first; only report that if this tool itself returns a not-connected error. Read-only, so it runs immediately without confirmation.",
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
      "Read the text content of a Google Drive file by its ID (get IDs from list_drive_files; if the user says 'read the first one' after a listing, use the first file's ID from that result). Works for Google Docs, Google Slides, Google Sheets (first sheet as CSV), PDFs with a text layer, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), and plain-text files (.txt, .md, .csv, .json). Cannot read images, scanned PDFs, older .doc/.xls/.ppt files, or folders - it will say so. Long files are truncated. Read-only, so it runs immediately without confirmation.",
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
