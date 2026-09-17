// src/lib/assistant/tool-executors.ts

import crypto from "crypto";
import OpenAI, { toFile } from "openai";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import { extractFromUrl, cleanText } from "@/lib/knowledge/extract-text";
import { processDocument } from "@/lib/knowledge/process-document";
import type { RoleKey } from "@prisma/client";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// No custom domain yet — production is this fixed Vercel URL. If a custom
// domain is ever added, update this (a tool executor has no access to the
// incoming request's origin the way a route handler does).
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://companyos-ai-foundation.vercel.app";

interface ExecutorContext {
  organizationId: string;
  userId: string;
  role: RoleKey;
  // Populated by the chat route (only for the current turn) when the
  // user's latest message includes an attached image — used by
  // edit_image. Not present when called from the execute-action route.
  attachedImageDataUrl?: string;
}

// ── PERMISSION GATING ────────────────────────────────────────────────
// Tools not listed here are allowed for any role (e.g. read-only tools,
// and update_profile since that only affects the confirming user).
const TOOL_MIN_ROLES: Record<string, RoleKey[]> = {
  generate_image: ["OWNER", "ADMIN"],
  edit_image: ["OWNER", "ADMIN"],
  invite_member: ["OWNER", "ADMIN"],
  change_member_role: ["OWNER", "ADMIN"],
  // Deliberately OWNER only — matches the real transfer-ownership/initiate
  // endpoint's own rule, and is double-checked directly against
  // Organization.ownerId inside the executor below (not just the Role
  // label), since keeping those in sync is the whole point of this tool.
  initiate_ownership_transfer: ["OWNER"],
  update_organization_name: ["OWNER", "ADMIN"],
  update_security_settings: ["OWNER", "ADMIN"],
  update_notification_settings: ["OWNER", "ADMIN"],
  create_knowledge_document: ["OWNER", "ADMIN"],
  create_document_draft: ["OWNER", "ADMIN"],
  update_document_content: ["OWNER", "ADMIN"],
  delete_knowledge_document: ["OWNER", "ADMIN"],
};

function assertPermission(toolName: string, ctx: ExecutorContext) {
  const allowedRoles = TOOL_MIN_ROLES[toolName];
  if (!allowedRoles) return; // no restriction for this tool

  if (!allowedRoles.includes(ctx.role)) {
    throw new Error(
      `You don't have permission to approve this action. Only ${allowedRoles
        .map((r) => (r === "OWNER" ? "the Owner" : r.charAt(0) + r.slice(1).toLowerCase() + "s"))
        .join(" or ")} can do this — your role is ${ctx.role}.`
    );
  }
}

// ── SHARED CHUNKING/EMBEDDING HELPER ────────────────────────────────────

function chunkText(text: string, chunkSize = 1000, overlap = 150): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      const sentenceBreak = text.lastIndexOf(". ", end);
      if (paragraphBreak > start + chunkSize * 0.5) {
        end = paragraphBreak;
      } else if (sentenceBreak > start + chunkSize * 0.5) {
        end = sentenceBreak + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start < 0 || end >= text.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}

async function embedAndStoreChunks(
  text: string,
  documentId: string,
  organizationId: string
): Promise<number> {
  const supabase = await createClient();
  const chunks = chunkText(text);

  for (let i = 0; i < chunks.length; i++) {
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunks[i]!,
    });
    const embedding = embeddingResponse.data[0]!.embedding;

    const { error } = await supabase.from("knowledge_chunks").insert({
      documentId,
      organizationId,
      chunkIndex: i,
      content: chunks[i]!,
      embedding,
    });

    if (error) throw new Error(`Failed to store chunk ${i}: ${error.message}`);
  }

  return chunks.length;
}

// ── SHARED IMAGE STORAGE HELPER ─────────────────────────────────────────
// Uses the admin/service-role Supabase client (bypassing RLS entirely)
// and a signed URL — the same proven approach the real file-upload route
// uses — rather than assuming the "knowledge-base" bucket is public.

async function uploadImageToStorage(
  buffer: Buffer,
  organizationId: string,
  folder: "generated-images" | "edited-images"
): Promise<string> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const storagePath = `${organizationId}/${folder}/${Date.now()}-image.png`;

  const { error: uploadError } = await admin.storage
    .from("knowledge-base")
    .upload(storagePath, buffer, { contentType: "image/png" });

  if (uploadError)
    throw new Error(`Failed to save image: ${uploadError.message}`);

  const { data: signedUrlData, error: signError } = await admin.storage
    .from("knowledge-base")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // valid ~1 year

  if (signError || !signedUrlData?.signedUrl)
    throw new Error(
      `Image saved, but couldn't create a link: ${signError?.message ?? "unknown error"}`
    );

  return signedUrlData.signedUrl;
}

// ── READ-ONLY EXECUTORS ───────────────────────────────────────────────

async function searchKnowledgeBase(
  args: { query: string; limit?: number },
  ctx: ExecutorContext
) {
  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: args.query,
  });
  const queryEmbedding = embeddingResponse.data[0]!.embedding;

  const supabase = await createClient();
  const { data: results, error } = await supabase.rpc(
    "match_knowledge_chunks",
    {
      query_embedding: queryEmbedding,
      match_organization_id: ctx.organizationId,
      match_count: Math.min(args.limit ?? 8, 20),
      match_category: null,
    }
  );

  if (error) throw new Error(`Knowledge search failed: ${error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (results ?? []).map((r: any) => ({
    content: r.content,
    similarity: r.similarity,
    documentTitle: r.title,
    sourceType: r.sourceType,
    category: r.category,
  }));
}

async function listDocuments(
  args: { category?: string; status?: string },
  ctx: ExecutorContext
) {
  const supabase = await createClient();
  let query = supabase
    .from("knowledge_documents")
    .select("id, title, category, sourceType, status, fileSizeBytes, createdAt")
    .eq("organizationId", ctx.organizationId)
    .order("createdAt", { ascending: false });

  if (args.category) query = query.eq("category", args.category);
  if (args.status) query = query.eq("status", args.status);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list documents: ${error.message}`);
  return data;
}

async function getMembers(_args: unknown, ctx: ExecutorContext) {
  const memberships = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId, isActive: true },
    include: { user: true, role: true },
  });
  return memberships.map((m) => ({
    name: m.user.fullName,
    email: m.user.email,
    role: m.role.name,
    joinedAt: m.joinedAt,
  }));
}

async function getActivityLogs(args: { limit?: number }, ctx: ExecutorContext) {
  const logs = await prisma.activityLog.findMany({
    where: { organizationId: ctx.organizationId },
    include: { actor: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 20,
  });
  return logs.map((l) => ({
    actor: l.actor?.fullName ?? l.actor?.email ?? "System",
    category: l.category,
    action: l.action,
    createdAt: l.createdAt,
  }));
}

async function getNotifications(_args: unknown, ctx: ExecutorContext) {
  const notifications = await prisma.notification.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  return { unreadCount, notifications };
}

async function getOrganizationSettings(_args: unknown, ctx: ExecutorContext) {
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    include: { settings: true },
  });
  return org;
}

async function generateImage(
  args: { prompt: string; size?: string },
  ctx: ExecutorContext
) {
  const validSizes = ["1024x1024", "1536x1024", "1024x1536"] as const;
  const size = validSizes.includes(args.size as typeof validSizes[number])
    ? (args.size as typeof validSizes[number])
    : "1024x1024";

  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt: args.prompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    size: size as any,
    n: 1,
  });

  const image = response.data?.[0];
  if (!image) throw new Error("Image generation failed — no image returned.");

  let buffer: Buffer;
  if (image.b64_json) {
    buffer = Buffer.from(image.b64_json, "base64");
  } else if (image.url) {
    const fetched = await fetch(image.url);
    buffer = Buffer.from(await fetched.arrayBuffer());
  } else {
    throw new Error("Image generation failed — no image data returned.");
  }

  const url = await uploadImageToStorage(
    buffer,
    ctx.organizationId,
    "generated-images"
  );

  return { url, revisedPrompt: image.revised_prompt ?? args.prompt };
}

async function editImage(args: { prompt: string }, ctx: ExecutorContext) {
  if (!ctx.attachedImageDataUrl) {
    throw new Error(
      "No image is attached to this message. Attach an image, then ask me to edit it in the same message."
    );
  }

  const match = ctx.attachedImageDataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("The attached image data is in an unexpected format.");

  const mimeType = match[1]!;
  const base64Data = match[2]!;
  const sourceBuffer = Buffer.from(base64Data, "base64");
  const extension = mimeType.split("/")[1] ?? "png";

  const imageFile = await toFile(sourceBuffer, `source.${extension}`, {
    type: mimeType,
  });

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: imageFile,
    prompt: args.prompt,
  });

  const image = response.data?.[0];
  if (!image) throw new Error("Image editing failed — no image returned.");

  let buffer: Buffer;
  if (image.b64_json) {
    buffer = Buffer.from(image.b64_json, "base64");
  } else if (image.url) {
    const fetched = await fetch(image.url);
    buffer = Buffer.from(await fetched.arrayBuffer());
  } else {
    throw new Error("Image editing failed — no image data returned.");
  }

  const url = await uploadImageToStorage(
    buffer,
    ctx.organizationId,
    "edited-images"
  );

  return { url, revisedPrompt: args.prompt };
}

// ── MUTATING EXECUTORS (only called after user confirms) ───────────────

async function inviteMember(
  args: { email: string; role: string },
  ctx: ExecutorContext
) {
  const roleKey = args.role.toUpperCase() as RoleKey;
  if (!["ADMIN", "MEMBER", "VIEWER"].includes(roleKey)) {
    throw new Error(`Invalid role: ${args.role}`);
  }

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: ctx.organizationId,
      email: args.email,
      roleKey,
      token: crypto.randomBytes(32).toString("hex"),
      invitedById: ctx.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  return invitation;
}

async function changeMemberRole(
  args: { email: string; newRole: string },
  ctx: ExecutorContext
) {
  const roleKey = args.newRole.toUpperCase() as RoleKey;

  if (roleKey === "OWNER") {
    throw new Error(
      "Can't set someone to Owner this way. Use initiate_ownership_transfer instead — real ownership transfer requires the recipient to accept an invite link."
    );
  }

  if (!["ADMIN", "MEMBER", "VIEWER"].includes(roleKey)) {
    throw new Error(`Invalid role: ${args.newRole}`);
  }

  const membership = await prisma.membership.findFirst({
    where: {
      organizationId: ctx.organizationId,
      user: { email: args.email },
    },
    include: { user: true, role: true },
  });

  if (!membership) {
    throw new Error(
      `No member with email ${args.email} found in this organization.`
    );
  }

  if (membership.role.key === "OWNER") {
    throw new Error(
      "Can't change the current Owner's role this way. Use initiate_ownership_transfer to hand off ownership first."
    );
  }

  const role = await prisma.role.findUnique({
    where: {
      organizationId_key: { organizationId: ctx.organizationId, key: roleKey },
    },
  });

  if (!role) {
    throw new Error(`Role ${roleKey} is not configured for this organization.`);
  }

  await prisma.membership.update({
    where: { id: membership.id },
    data: { roleId: role.id },
  });

  return { email: args.email, newRole: roleKey };
}

async function initiateOwnershipTransfer(
  args: { targetEmail: string },
  ctx: ExecutorContext
) {
  const targetEmail = args.targetEmail.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    throw new Error("Enter a valid email address.");
  }

  const organization = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
  });

  // Defense in depth: check the real Organization.ownerId field directly,
  // not just the Role label — matching the real API route's own check
  // exactly, and guarding against the two ever having drifted apart.
  if (!organization || organization.ownerId !== ctx.userId) {
    throw new Error("Only the current owner can transfer ownership.");
  }

  const requester = await prisma.user.findUnique({ where: { id: ctx.userId } });
  if (requester?.email?.toLowerCase() === targetEmail) {
    throw new Error("You already own this organization.");
  }

  const supabase = await createClient();

  await supabase
    .from("ownership_transfers")
    .update({ status: "CANCELLED" })
    .eq("organizationId", ctx.organizationId)
    .eq("status", "PENDING");

  const targetUser = await prisma.user.findUnique({ where: { email: targetEmail } });
  const token = crypto.randomBytes(24).toString("hex");

  const { data: transfer, error: insertError } = await supabase
    .from("ownership_transfers")
    .insert({
      organizationId: ctx.organizationId,
      currentOwnerId: ctx.userId,
      targetEmail,
      targetUserId: targetUser?.id ?? null,
      token,
    })
    .select()
    .single();

  if (insertError || !transfer) {
    throw new Error(insertError?.message ?? "Couldn't start the transfer.");
  }

  await prisma.activityLog.create({
    data: {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      category: "ORGANIZATION",
      action: "organization.ownership_transfer_initiated",
      metadata: { targetEmail },
    },
  });

  const transferUrl = `${APP_BASE_URL}/transfer-ownership/${token}`;

  return {
    targetEmail,
    transferUrl,
    note: "The recipient must open this link while signed in with that email and accept it. You remain the owner until they do.",
  };
}

async function updateOrganizationName(
  args: { name?: string; slug?: string },
  ctx: ExecutorContext
) {
  return prisma.organization.update({
    where: { id: ctx.organizationId },
    data: {
      ...(args.name ? { name: args.name } : {}),
      ...(args.slug ? { slug: args.slug } : {}),
    },
  });
}

async function updateSecuritySettings(
  args: { require2FA?: boolean },
  ctx: ExecutorContext
) {
  return prisma.organizationSettings.upsert({
    where: { organizationId: ctx.organizationId },
    update: {
      ...(args.require2FA !== undefined
        ? { requireTwoFactor: args.require2FA }
        : {}),
    },
    create: {
      organizationId: ctx.organizationId,
      requireTwoFactor: args.require2FA ?? false,
    },
  });
}

async function updateNotificationSettings(
  args: { notifyOnNewMember?: boolean; notifyOnBillingEvents?: boolean },
  ctx: ExecutorContext
) {
  return prisma.organizationSettings.upsert({
    where: { organizationId: ctx.organizationId },
    update: args,
    create: {
      organizationId: ctx.organizationId,
      notifyOnNewMember: args.notifyOnNewMember ?? true,
      notifyOnBillingEvents: args.notifyOnBillingEvents ?? true,
    },
  });
}

async function updateProfile(args: { name: string }, ctx: ExecutorContext) {
  return prisma.user.update({
    where: { id: ctx.userId },
    data: { fullName: args.name },
  });
}

async function createKnowledgeDocument(
  args: { url: string; category?: string },
  ctx: ExecutorContext
) {
  const supabase = await createClient();
  const { data: doc, error } = await supabase
    .from("knowledge_documents")
    .insert({
      organizationId: ctx.organizationId,
      uploadedBy: ctx.userId,
      title: args.url,
      sourceType: "url",
      sourceUrl: args.url,
      category: args.category ?? "general",
      status: "EXTRACTING",
    })
    .select()
    .single();

  if (error)
    throw new Error(`Failed to create knowledge document: ${error.message}`);

  const documentId = doc.id as string;

  const extractResult = await extractFromUrl(args.url);

  if ("error" in extractResult) {
    await supabase
      .from("knowledge_documents")
      .update({ status: "FAILED", errorMessage: extractResult.error })
      .eq("id", documentId);
    throw new Error(`Couldn't extract content from that URL: ${extractResult.error}`);
  }

  await processDocument({
    documentId,
    organizationId: ctx.organizationId,
    rawText: cleanText(extractResult.text),
    extraMetadata: { sourceUrl: args.url, sourceType: "url" },
  });

  return { documentId, status: "READY", url: args.url };
}

async function createDocumentDraft(
  args: { title: string; content: string; category: string },
  ctx: ExecutorContext
) {
  const supabase = await createClient();
  const { data: doc, error } = await supabase
    .from("knowledge_documents")
    .insert({
      organizationId: ctx.organizationId,
      uploadedBy: ctx.userId,
      title: args.title,
      sourceType: "ai_draft",
      category: args.category,
      status: "READY",
      extractedText: args.content,
      chunkCount: 0,
    })
    .select()
    .single();

  if (error)
    throw new Error(`Failed to create document draft: ${error.message}`);

  const chunkCount = await embedAndStoreChunks(
    args.content,
    doc.id,
    ctx.organizationId
  );

  await supabase
    .from("knowledge_documents")
    .update({ chunkCount })
    .eq("id", doc.id);

  return { ...doc, chunkCount };
}

async function updateDocumentContent(
  args: { documentId: string; content: string },
  ctx: ExecutorContext
) {
  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("knowledge_documents")
    .select("id")
    .eq("id", args.documentId)
    .eq("organizationId", ctx.organizationId)
    .single();

  if (fetchError || !existing)
    throw new Error("Document not found in this organization.");

  const { error: deleteError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("documentId", args.documentId);

  if (deleteError)
    throw new Error(`Failed to clear old chunks: ${deleteError.message}`);

  const chunkCount = await embedAndStoreChunks(
    args.content,
    args.documentId,
    ctx.organizationId
  );

  const { data: updated, error: updateError } = await supabase
    .from("knowledge_documents")
    .update({
      extractedText: args.content,
      chunkCount,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", args.documentId)
    .select()
    .single();

  if (updateError)
    throw new Error(`Failed to update document: ${updateError.message}`);

  return updated;
}

async function deleteKnowledgeDocument(
  args: { documentId: string },
  ctx: ExecutorContext
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("id", args.documentId)
    .eq("organizationId", ctx.organizationId);

  if (error)
    throw new Error(`Failed to delete knowledge document: ${error.message}`);
  return { deleted: true, documentId: args.documentId };
}

// ── DISPATCH TABLE ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExecutorFn = (args: any, ctx: ExecutorContext) => Promise<unknown>;

export const TOOL_EXECUTORS: Record<string, ExecutorFn> = {
  search_knowledge_base: searchKnowledgeBase,
  generate_image: generateImage,
  edit_image: editImage,
  list_documents: listDocuments,
  get_members: getMembers,
  get_activity_logs: getActivityLogs,
  get_notifications: getNotifications,
  get_organization_settings: getOrganizationSettings,
  invite_member: inviteMember,
  change_member_role: changeMemberRole,
  initiate_ownership_transfer: initiateOwnershipTransfer,
  update_organization_name: updateOrganizationName,
  update_security_settings: updateSecuritySettings,
  update_notification_settings: updateNotificationSettings,
  update_profile: updateProfile,
  create_knowledge_document: createKnowledgeDocument,
  create_document_draft: createDocumentDraft,
  update_document_content: updateDocumentContent,
  delete_knowledge_document: deleteKnowledgeDocument,
};

export async function executeTool(
  toolName: string,
  args: unknown,
  ctx: ExecutorContext
): Promise<unknown> {
  const fn = TOOL_EXECUTORS[toolName];
  if (!fn) throw new Error(`Unknown tool: ${toolName}`);

  assertPermission(toolName, ctx);

  return fn(args, ctx);
}

export async function buildExecutorContext(): Promise<ExecutorContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) throw new Error("No active organization");

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    include: { role: true },
  });

  if (!membership) throw new Error("Not a member of this organization");

  return { organizationId, userId: user.id, role: membership.role.key };
}
