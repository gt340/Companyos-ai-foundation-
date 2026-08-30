import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getActiveOrganizationId } from "@/lib/active-org";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: doc } = await admin
    .from("knowledge_documents")
    .select("storagePath")
    .eq("id", id)
    .eq("organizationId", organizationId)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Chunks are removed automatically via the foreign key's ON DELETE CASCADE.
  const { error: deleteError } = await admin
    .from("knowledge_documents")
    .delete()
    .eq("id", id)
    .eq("organizationId", organizationId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  if (doc.storagePath) {
    await admin.storage.from("knowledge-base").remove([doc.storagePath]);
  }

  return NextResponse.json({ success: true });
}
