// src/lib/assistant/tool-executors.ts

import crypto from "crypto";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import type { RoleKey } from "@prisma/client";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface ExecutorContext {
  organizationId: string;
  userId: string;
  role: RoleKey;
}

// ── PERMISSION GATING ────────────────────────────────────────────────
// Tools not listed here are allowed for any role (e.g. read-only tools,
// and update_profile since that only affects the confirming user).
const TOOL_MIN_ROLES: Record<string, RoleKey[]> = {
  generate_image: ["OWNER", "ADMIN"],
  invite_member: ["OWNER", "ADMIN"],
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
      `You don't have permission to approve this action. Only Owners and Admins can do this — your role is ${ctx.role}.`
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
      content: chunks[i],
      embedding,
    });

    if (error) throw new Error(`Failed to store chunk ${i}: ${error.message}`);
  }

  return chunks.length;
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

async function generateImage(args: { prompt: string; size?: string }) {
  const validSizes = ["1024x1024", "1792x1024", "1024x1792"] as const;
  const size = validSizes.includes(args.size as typeof validSizes[number])
    ? (args.size as typeof validSizes[number])
    : "1024x1024";

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: args.prompt,
    size,
    n: 1,
    response_format: "url",
  });

  const image = response.data?.[0];
  if (!image?.url) throw new Error("Image generation failed — no image returned.");

  return { url: image.url, revisedPrompt: image.revised_prompt ?? args.prompt };
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
  const { data, error } = await supabase
    .from("knowledge_documents")
    .insert({
      organizationId: ctx.organizationId,
      uploadedBy: ctx.userId,
      title: args.url,
      sourceType: "URL",
      sourceUrl: args.url,
      category: args.category ?? "general",
      status: "PENDING",
    })
    .select()
    .single();

  if (error)
    throw new Error(`Failed to create knowledge document: ${error.message}`);

  return data;
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
      sourceType: "AI_DRAFT",
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
      content: chunks[i]!,
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
  list_documents: listDocuments,
  get_members: getMembers,
  get_activity_logs: getActivityLogs,
  get_notifications: getNotifications,
  get_organization_settings: getOrganizationSettings,
  invite_member: inviteMember,
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
