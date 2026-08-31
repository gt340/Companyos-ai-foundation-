import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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

  const body = await request.json().catch(() => null);
  const query = body?.query as string | undefined;
  const category = (body?.category as string | undefined) ?? null;
  const matchCount = Math.min(Number(body?.matchCount) || 8, 20);

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: "Query is required" }, { status: 422 });
  }

  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  const queryEmbedding = embeddingResponse.data[0]!.embedding;

  const { data: results, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: queryEmbedding,
    match_organization_id: organizationId,
    match_count: matchCount,
    match_category: category,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    query,
    results: (results ?? []).map((r: { id: string; documentId: string; content: string; similarity: number; title: string; sourceType: string; category: string }) => ({
      chunkId: r.id,
      documentId: r.documentId,
      content: r.content,
      similarity: r.similarity,
      documentTitle: r.title,
      sourceType: r.sourceType,
      category: r.category,
    })),
  });
}
