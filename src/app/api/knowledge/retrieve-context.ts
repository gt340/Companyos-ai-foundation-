import OpenAI from "openai";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface RetrievedChunk {
  content: string;
  documentTitle: string;
  sourceType: string;
  similarity: number;
}

interface RetrieveContextOptions {
  organizationId: string;
  query: string;
  matchCount?: number;
  category?: string;
  minSimilarity?: number;
}

interface MatchRow {
  content: string;
  title: string;
  sourceType: string;
  similarity: number;
}

export async function retrieveContext({
  organizationId,
  query,
  matchCount = 6,
  category,
  minSimilarity = 0.3,
}: RetrieveContextOptions): Promise<{ chunks: RetrievedChunk[]; promptBlock: string }> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  const queryEmbedding = embeddingResponse.data[0]!.embedding;

  const { data: results, error } = await admin.rpc("match_knowledge_chunks", {
    query_embedding: queryEmbedding,
    match_organization_id: organizationId,
    match_count: matchCount,
    match_category: category ?? null,
  });

  if (error || !results) {
    return { chunks: [], promptBlock: "" };
  }

  const rows = results as MatchRow[];

  const chunks: RetrievedChunk[] = rows
    .filter((r) => r.similarity >= minSimilarity)
    .map((r) => ({
      content: r.content,
      documentTitle: r.title,
      sourceType: r.sourceType,
      similarity: r.similarity,
    }));

  if (chunks.length === 0) {
    return { chunks: [], promptBlock: "" };
  }

  const promptBlock = [
    "The following are relevant excerpts from this organization's knowledge base. Use them to ground your answer in the company's actual documented policies, contracts, and procedures. If the excerpts don't contain the answer, say so honestly rather than guessing.",
    "",
    ...chunks.map((c, i) => `[Source ${i + 1}: "${c.documentTitle}"]\n${c.content}`),
  ].join("\n\n");

  return { chunks, promptBlock };
}
