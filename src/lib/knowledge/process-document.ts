import OpenAI from "openai";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cleanText } from "./extract-text";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

export function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return text.length > 0 ? [text] : [];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);

    if (end < text.length) {
      const window = text.slice(start + CHUNK_SIZE - 200, end + 1);
      const lastBreak = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
      if (lastBreak !== -1) {
        end = start + CHUNK_SIZE - 200 + lastBreak + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);

    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

interface ProcessDocumentOptions {
  documentId: string;
  organizationId: string;
  rawText: string;
  extraMetadata?: Record<string, unknown>;
}

export async function processDocument({
  documentId,
  organizationId,
  rawText,
  extraMetadata = {},
}: ProcessDocumentOptions): Promise<{ success: boolean; error?: string }> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    await admin
      .from("knowledge_documents")
      .update({ status: "CHUNKING", updatedAt: new Date().toISOString() })
      .eq("id", documentId);

    const cleaned = cleanText(rawText);

    if (cleaned.length === 0) {
      await admin
        .from("knowledge_documents")
        .update({ status: "FAILED", errorMessage: "No text content found in this document" })
        .eq("id", documentId);
      return { success: false, error: "No text content found" };
    }

    const chunks = splitIntoChunks(cleaned);

    await admin
      .from("knowledge_documents")
      .update({ status: "EMBEDDING", extractedText: cleaned.slice(0, 50000) })
      .eq("id", documentId);

    const BATCH_SIZE = 50;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await embedBatch(batch);
      allEmbeddings.push(...embeddings);
    }

    const rows = chunks.map((content, index) => ({
      documentId,
      organizationId,
      chunkIndex: index,
      content,
      embedding: allEmbeddings[index],
      metadata: extraMetadata,
    }));

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await admin.from("knowledge_chunks").insert(batch);
      if (insertError) throw new Error(insertError.message);
    }

    await admin
      .from("knowledge_documents")
      .update({
        status: "READY",
        chunkCount: chunks.length,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", documentId);

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    await admin
      .from("knowledge_documents")
      .update({ status: "FAILED", errorMessage: message, updatedAt: new Date().toISOString() })
      .eq("id", documentId);
    return { success: false, error: message };
  }
        }
