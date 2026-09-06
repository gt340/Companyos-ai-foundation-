import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) {
    return NextResponse.json({ documents: [] });
  }

  const { data, error } = await supabase
    .from("knowledge_documents")
    .select("id, title, sourceType, category, status, errorMessage, chunkCount, storagePath, sourceUrl, createdAt")
    .eq("organizationId", organizationId)
    .order("createdAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const documents = await Promise.all(
    (data ?? []).map(async (doc) => {
      let viewUrl: string | null = doc.sourceUrl ?? null;
      if (doc.storagePath) {
        const { data: signed } = await supabase.storage
          .from("knowledge-base")
          .createSignedUrl(doc.storagePath, 60 * 60);
        viewUrl = signed?.signedUrl ?? null;
      }
      return { ...doc, viewUrl };
    })
  );

  return NextResponse.json({ documents });
}
