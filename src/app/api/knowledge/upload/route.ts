import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getActiveOrganizationId } from "@/lib/active-org";
import {
  extractFromPdf,
  extractFromWord,
  extractFromExcel,
  extractFromPowerPoint,
  extractFromImage,
  extractFromAudioOrVideo,
} from "@/lib/knowledge/extract-text";
import { processDocument } from "@/lib/knowledge/process-document";

export const maxDuration = 60;

const TYPE_MAP: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "powerpoint",
};

function resolveSourceType(mimeType: string): string | null {
  if (TYPE_MAP[mimeType]) return TYPE_MAP[mimeType];
  if (mimeType.startsWith("image/")) return "image";
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

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const category = (formData.get("category") as string | null) ?? "general";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 422 });
  }

  const sourceType = resolveSourceType(file.type);
  if (!sourceType) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 422 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const storagePath = `${organizationId}/${Date.now()}-${file.name}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await admin.storage
    .from("knowledge-base")
    .upload(storagePath, buffer, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: doc, error: docError } = await admin
    .from("knowledge_documents")
    .insert({
      organizationId,
      uploadedBy: user.id,
      title: file.name,
      sourceType,
      category,
      originalFilename: file.name,
      storagePath,
      fileSizeBytes: file.size,
      status: "EXTRACTING",
    })
    .select()
    .single();

  if (docError || !doc) {
    return NextResponse.json({ error: docError?.message ?? "Couldn't create document record" }, { status: 500 });
  }

  const documentId = doc.id as string;

  // Closure over the variables above — avoids passing the Supabase admin
  // client as a typed function parameter, which triggers a generic-type
  // mismatch under this project's strict TypeScript settings.
  async function runExtractionAndProcessing() {
    let extractResult;
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
        case "image":
          extractResult = await extractFromImage(buffer, file!.type);
          break;
        case "video":
        case "audio":
          await admin.from("knowledge_documents").update({ status: "TRANSCRIBING" }).eq("id", documentId);
          extractResult = await extractFromAudioOrVideo(file!);
          break;
        default:
          extractResult = { error: "Unsupported type" };
      }
    } catch (err) {
      extractResult = { error: err instanceof Error ? err.message : "Extraction failed" };
    }

    if ("error" in extractResult) {
      await admin
        .from("knowledge_documents")
        .update({ status: "FAILED", errorMessage: extractResult.error })
        .eq("id", documentId);
      return;
    }

    await processDocument({
      documentId,
      organizationId: organizationId as string,
      rawText: extractResult.text,
      extraMetadata: { originalFilename: file!.name, sourceType },
    });
  }

  after(() => runExtractionAndProcessing());

  return NextResponse.json({ documentId, status: "EXTRACTING" });
  }
