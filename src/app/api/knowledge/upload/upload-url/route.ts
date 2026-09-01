import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getActiveOrganizationId } from "@/lib/active-org";
import { extractFromUrl } from "@/lib/knowledge/extract-text";
import { processDocument } from "@/lib/knowledge/process-document";

export const maxDuration = 60;

export async function POST(request: Request) {
 try {
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
  const url = body?.url as string | undefined;
  const category = (body?.category as string | undefined) ?? "general";

  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "Enter a valid URL starting with http:// or https://" }, { status: 422 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let title: string;
  try {
    title = new URL(url).hostname;
  } catch {
    title = url;
  }

  const { data: doc, error: docError } = await admin
    .from("knowledge_documents")
    .insert({
      organizationId,
      uploadedBy: user.id,
      title,
      sourceType: "url",
      category,
      sourceUrl: url,
      status: "EXTRACTING",
    })
    .select()
    .single();

  if (docError || !doc) {
    return NextResponse.json({ error: docError?.message ?? "Couldn't create document record" }, { status: 500 });
  }

  const documentId = doc.id as string;

  // Closure over the variables above — matches the pattern used in
  // upload/route.ts, avoiding a generic-type mismatch that occurs when
  // the Supabase admin client is passed as an explicitly-typed parameter.
  async function runUrlProcessing() {
    const extractResult = await extractFromUrl(url!);

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
      extraMetadata: { sourceUrl: url, category },
    });
  }

  after(() => runUrlProcessing());

  return NextResponse.json({ documentId, status: "EXTRACTING" });
 } catch (err) {
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Unexpected server error" },
    { status: 500 }
  );
 }
}
