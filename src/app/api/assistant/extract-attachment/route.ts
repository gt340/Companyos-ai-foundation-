// src/app/api/assistant/extract-attachment/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  extractFromPdf,
  extractFromWord,
  extractFromExcel,
  extractFromPowerPoint,
  extractFromAudioOrVideo,
  cleanText,
} from "@/lib/knowledge/extract-text";

export const maxDuration = 60;

const TYPE_MAP: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "excel",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "powerpoint",
};

function resolveSourceType(mimeType: string): string | null {
  if (TYPE_MAP[mimeType]) return TYPE_MAP[mimeType];
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 422 });
  }

  const sourceType = resolveSourceType(file.type);
  if (!sourceType) {
    return NextResponse.json(
      { error: `Unsupported file type for chat attachments: ${file.type}` },
      { status: 422 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let extractResult: { text: string } | { error: string };
  try {
    switch (sourceType) {
      case "pdf":
        extractResult = await extractFromPdf(buffer);
        break;
      case "word":
        extractResult = await extractFromWord(buffer);
        break;
      case "excel":
        extractResult = await extractFromExcel(buffer);
        break;
      case "powerpoint":
        extractResult = await extractFromPowerPoint(buffer);
        break;
      case "video":
      case "audio":
        extractResult = await extractFromAudioOrVideo(file);
        break;
      default:
        extractResult = { error: "Unsupported type" };
    }
  } catch (err) {
    extractResult = {
      error: err instanceof Error ? err.message : "Extraction failed",
    };
  }

  if ("error" in extractResult) {
    return NextResponse.json({ error: extractResult.error }, { status: 500 });
  }

  return NextResponse.json({
    text: cleanText(extractResult.text),
    sourceType,
    fileName: file.name,
  });
}
