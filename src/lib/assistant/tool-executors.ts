// src/lib/assistant/tool-executors.ts

import crypto from "crypto";
import OpenAI, { toFile } from "openai";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import { extractFromUrl, cleanText } from "@/lib/knowledge/extract-text";
import { processDocument } from "@/lib/knowledge/process-document";
import type { RoleKey, MemoryType } from "@prisma/client";

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
  agentId: string; // this organization's CEO Agent record
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
  generate_executive_report: ["OWNER", "ADMIN"],
  generate_strategic_plan: ["OWNER", "ADMIN"],
  generate_risk_analysis: ["OWNER", "ADMIN"],
  remember_ceo_insight: ["OWNER", "ADMIN"],
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

// ── CEO AGENT FOUNDATION: prompt templates + agent seeding ─────────────

const CEO_PROMPT_TEMPLATES: {
  purpose: string;
  name: string;
  description: string;
  content: string;
}[] = [
  {
    purpose: "ceo_system",
    name: "CEO System Prompt",
    description: "Core identity and ground rules for the CEO Agent.",
    content:
      "You are the CEO Agent — an AI executive assistant to this company's founder/owner, operating inside CompanyOS AI. You have access to the company's real profile, knowledge base, and memory. You must never invent company facts, financial figures, KPIs, or business data that hasn't actually been provided to you. When information is unavailable, state clearly that it is unavailable rather than guessing or estimating. Think and communicate like a sharp, honest chief of staff: direct, concise, and grounded only in what's actually known about the company.",
  },
  {
    purpose: "executive_analysis",
    name: "Executive Analysis Prompt",
    description: "General-purpose grounded analysis of company information.",
    content:
      "Analyze the provided company information and answer the request. Base every claim on the company context, knowledge base results, and memory given to you — do not introduce outside assumptions about the business. If the information needed to fully answer isn't available, say so explicitly rather than filling the gap with a plausible-sounding guess.",
  },
  {
    purpose: "executive_report",
    name: "Executive Report Prompt",
    description: "Structured executive report generation.",
    content:
      "Generate a structured executive report using only the company context, knowledge base excerpts, and memory provided. Produce these sections, skipping any with genuinely nothing to say: Executive Summary, Company Status, Key Goals, Key Performance Indicators, Sales/Revenue Insights, Customer Insights, Marketing Insights, Financial Insights, Operational Insights, Risks, Opportunities, Important Decisions, Recommended Next Actions, Information Gaps. Label each piece of content as one of: FACT (directly stated in the provided data), ANALYSIS (your reasoning about the facts), INSIGHT (a pattern or implication you've identified), RECOMMENDATION (a suggested action), or DATA GAP (something relevant that isn't available). If a data source (financials, sales, marketing, etc.) isn't connected, say plainly that it isn't connected in that section rather than inventing numbers. Never fabricate revenue, profit, customer counts, or any other business metric.",
  },
  {
    purpose: "company_overview",
    name: "Company Overview Prompt",
    description: "Grounded summary of the company's stored profile.",
    content:
      "Summarize the company's identity based only on its stored profile: name, industry, mission, vision, goals, products, services, target customers, competitors, and team structure. Note plainly which of these fields are empty or unset rather than inferring them.",
  },
  {
    purpose: "strategic_planning",
    name: "Strategic Planning Prompt",
    description: "Grounded strategic planning assistance.",
    content:
      "Produce a structured strategic plan using only the company's actual stated goals, mission, vision, and known context. Cover, where there's real material to base it on: current strategic position, progress against stated goals, opportunities aligned with the company's actual mission and market, recommended strategic priorities, and what information gap would need to be filled to plan further (e.g. missing KPI data, missing market research). Ground every suggestion in the company's real stated goals and constraints, never invented ones. Label content as FACT, ANALYSIS, INSIGHT, RECOMMENDATION, or DATA GAP, same as an executive report.",
  },
  {
    purpose: "risk_analysis",
    name: "Risk Analysis Prompt",
    description: "Grounded business risk identification.",
    content:
      "Identify potential business risks based only on what is actually known about the company: its industry, stage, team size, stated goals, and anything documented in its knowledge base or memory. Do not invent hypothetical financial or legal risks that aren't grounded in the company's real, known context — where you raise a general industry consideration rather than something drawn from the company's actual data, label it clearly as such rather than presenting it as a company-specific finding. Label content as FACT, ANALYSIS, INSIGHT, RECOMMENDATION, or DATA GAP, same as an executive report.",
  },
  {
    purpose: "kpi_analysis",
    name: "KPI Analysis Prompt",
    description: "Grounded KPI analysis with explicit gap reporting.",
    content:
      "Analyze available key performance indicators using only what has actually been provided. If no KPI data source is connected, state clearly that KPI tracking isn't connected yet and describe what would need to be integrated to support this, rather than presenting any placeholder or estimated numbers.",
  },
  {
    purpose: "decision_summary",
    name: "Decision Summary Prompt",
    description: "Summarizing and logging a business decision.",
    content:
      "Summarize a business decision the founder is making or has made, based on the conversation and stored memory. Capture the decision itself and the reasoning behind it as actually stated by the founder — do not add reasoning they didn't give. If asked to remember it, treat it as a DECISION-type memory.",
  },
];

async function ensurePromptTemplatesSeeded() {
  const count = await prisma.promptTemplate.count({ where: { agentType: "CEO" } });
  if (count >= CEO_PROMPT_TEMPLATES.length) return;

  for (const t of CEO_PROMPT_TEMPLATES) {
    await prisma.promptTemplate.upsert({
      where: {
        purpose_agentType_version: { purpose: t.purpose, agentType: "CEO", version: 1 },
      },
      update: {},
      create: {
        name: t.name,
        purpose: t.purpose,
        agentType: "CEO",
        description: t.description,
        content: t.content,
        version: 1,
        isActive: true,
      },
    });
  }
}

async function ensureCeoAgent(organizationId: string) {
  return prisma.agent.upsert({
    where: { organizationId_type: { organizationId, type: "CEO" } },
    update: {},
    create: { organizationId, type: "CEO", name: "CEO Agent" },
  });
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

const VALID_MEMORY_TYPES = [
  "COMPANY_FACT",
  "STRATEGIC_GOAL",
  "FOUNDER_PREFERENCE",
  "DECISION",
  "REPORT_SUMMARY",
  "BUSINESS_EVENT",
  "INSIGHT",
  "TASK_HISTORY",
];

async function listCeoMemories(
  args: { type?: string; limit?: number },
  ctx: ExecutorContext
) {
  const type = args.type?.toUpperCase();
  if (type && !VALID_MEMORY_TYPES.includes(type)) {
    throw new Error(`Invalid memory type: ${args.type}`);
  }

  const memories = await prisma.agentMemory.findMany({
    where: {
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      ...(type ? { type: type as MemoryType } : {}),
    },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    take: args.limit ?? 20,
  });

  return memories.map((m) => ({
    id: m.id,
    type: m.type,
    content: m.content,
    importance: m.importance,
    createdAt: m.createdAt,
  }));
}

async function listExecutiveReports(
  args: { limit?: number },
  ctx: ExecutorContext
) {
  return prisma.executiveReport.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 10,
    select: {
      id: true,
      title: true,
      status: true,
      reportingPeriod: true,
      summary: true,
      createdAt: true,
    },
  });
}

async function getExecutiveReport(
  args: { reportId: string },
  ctx: ExecutorContext
) {
  const report = await prisma.executiveReport.findFirst({
    where: { id: args.reportId, organizationId: ctx.organizationId },
    include: { sections: { orderBy: { order: "asc" } } },
  });

  if (!report) throw new Error("Report not found in this organization.");
  return report;
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

async function rememberCeoInsight(
  args: { type: string; content: string; importance?: number },
  ctx: ExecutorContext
) {
  const type = args.type.toUpperCase();
  if (!VALID_MEMORY_TYPES.includes(type)) {
    throw new Error(`Invalid memory type: ${args.type}`);
  }

  const memory = await prisma.agentMemory.create({
    data: {
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      type: type as MemoryType,
      content: args.content,
      importance: Math.min(5, Math.max(1, args.importance ?? 3)),
      createdBy: ctx.userId,
    },
  });

  return { id: memory.id, type: memory.type };
}

// ── SHARED GROUNDED-REPORT ENGINE ───────────────────────────────────────
// Powers generate_executive_report, generate_strategic_plan, and
// generate_risk_analysis. Only the prompt template used and the default
// title differ between them — the grounding (company profile + KB search
// + CEO memory), JSON-shape enforcement, and atomic save/fail logic are
// identical and shared here so the three tools can never drift apart.

interface GeneratedReportSection {
  title: string;
  sectionType: string;
  content: string;
  priority?: number;
  sourceRefs?: string[];
}

interface GroundedReportArgs {
  title?: string;
  reportingPeriod?: string;
  focusArea?: string;
}

async function runGroundedReport(
  templatePurpose: string,
  defaultTitle: string,
  args: GroundedReportArgs,
  ctx: ExecutorContext
) {
  const [company, organization, memories, systemTemplate, reportTemplate] =
    await Promise.all([
      prisma.company.findUnique({ where: { organizationId: ctx.organizationId } }),
      prisma.organization.findUnique({ where: { id: ctx.organizationId } }),
      prisma.agentMemory.findMany({
        where: { organizationId: ctx.organizationId, agentId: ctx.agentId },
        orderBy: { importance: "desc" },
        take: 20,
      }),
      prisma.promptTemplate.findFirst({
        where: { purpose: "ceo_system", agentType: "CEO", isActive: true },
      }),
      prisma.promptTemplate.findFirst({
        where: { purpose: templatePurpose, agentType: "CEO", isActive: true },
      }),
    ]);

  if (!reportTemplate) {
    throw new Error(`The "${templatePurpose}" prompt template isn't set up yet.`);
  }

  // Best-effort knowledge base excerpts — don't fail the whole report if
  // the knowledge base search itself errors. Use the focus area as the
  // search query when given, so a scoped request pulls more relevant
  // context than the generic query would.
  let knowledgeExcerpts: string[] = [];
  try {
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: args.focusArea || "company overview goals performance strategy",
    });
    const supabase = await createClient();
    const { data: results } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: embeddingResponse.data[0]!.embedding,
      match_organization_id: ctx.organizationId,
      match_count: 6,
      match_category: null,
    });
    knowledgeExcerpts = (results ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => `[${r.title}] ${r.content}`
    );
  } catch {
    // Knowledge base context is optional — proceed without it.
  }

  const companyContext = company
    ? [
        `Company name: ${organization?.name ?? "Unknown"}`,
        `Industry: ${company.industry}`,
        `Website: ${company.website ?? "Not set"}`,
        `Business size: ${company.businessSize}`,
        `Mission: ${company.mission ?? "Not set"}`,
        `Vision: ${company.vision ?? "Not set"}`,
        `Goals: ${company.goals.length ? company.goals.join("; ") : "Not set"}`,
        `Products: ${company.products.length ? company.products.join("; ") : "Not set"}`,
        `Services: ${company.services.length ? company.services.join("; ") : "Not set"}`,
        `Target customers: ${company.targetCustomers ?? "Not set"}`,
        `Competitors: ${company.competitors.length ? company.competitors.join("; ") : "Not set"}`,
        `Employee count: ${company.employeeCount ?? "Not set"}`,
      ].join("\n")
    : "No company profile has been completed yet — onboarding was not finished.";

  const memoryContext = memories.length
    ? memories.map((m) => `[${m.type}] ${m.content}`).join("\n")
    : "No stored CEO memory yet.";

  const knowledgeContext = knowledgeExcerpts.length
    ? knowledgeExcerpts.join("\n\n")
    : "No relevant knowledge base documents found.";

  const report = await prisma.executiveReport.create({
    data: {
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      generatedBy: ctx.userId,
      title: args.title || defaultTitle,
      reportingPeriod: args.reportingPeriod,
      status: "GENERATING",
    },
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemTemplate?.content ?? "You are the CEO Agent.",
        },
        {
          role: "user",
          content: `${reportTemplate.content}
${args.focusArea ? `\nFOCUS AREA REQUESTED BY THE FOUNDER: ${args.focusArea}\nPrioritize this focus area throughout, while still noting any broader information gaps relevant to it.\n` : ""}
COMPANY CONTEXT:
${companyContext}

RELEVANT KNOWLEDGE BASE EXCERPTS:
${knowledgeContext}

RELEVANT CEO MEMORY:
${memoryContext}

Return ONLY a JSON object shaped exactly like this:
{
  "summary": "2-4 sentence executive summary",
  "sections": [
    { "title": "string", "sectionType": "SUMMARY|STATUS|GOALS|STRATEGY|KPI|SALES|CUSTOMER|MARKETING|FINANCIAL|OPERATIONAL|RISK|OPPORTUNITY|DECISION|ACTION|DATA_GAP", "content": "string, include FACT/ANALYSIS/INSIGHT/RECOMMENDATION/DATA GAP labels inline where relevant", "priority": 1-5, "sourceRefs": ["string", ...] }
  ]
}
Omit sections with genuinely nothing to say rather than padding with empty content.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("The model returned no content.");

    let parsed: { summary?: string; sections?: GeneratedReportSection[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("The model's response wasn't valid JSON.");
    }

    const sections = parsed.sections ?? [];

    await prisma.$transaction([
      prisma.reportSection.createMany({
        data: sections.map((s, i) => ({
          reportId: report.id,
          title: s.title,
          sectionType: s.sectionType,
          content: s.content,
          priority: s.priority ?? 3,
          sourceRefs: s.sourceRefs ?? [],
          order: i,
        })),
      }),
      prisma.executiveReport.update({
        where: { id: report.id },
        data: { status: "COMPLETED", summary: parsed.summary ?? null },
      }),
    ]);

    return {
      reportId: report.id,
      title: report.title,
      summary: parsed.summary,
      sectionTitles: sections.map((s) => s.title),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.executiveReport.update({
      where: { id: report.id },
      data: { status: "FAILED", errorMessage: message },
    });
    throw err;
  }
}

async function generateExecutiveReport(
  args: GroundedReportArgs,
  ctx: ExecutorContext
) {
  return runGroundedReport(
    "executive_report",
    `Executive Report — ${new Date().toLocaleDateString()}`,
    args,
    ctx
  );
}

async function generateStrategicPlan(
  args: GroundedReportArgs,
  ctx: ExecutorContext
) {
  return runGroundedReport(
    "strategic_planning",
    `Strategic Plan — ${new Date().toLocaleDateString()}`,
    args,
    ctx
  );
}

async function generateRiskAnalysis(
  args: GroundedReportArgs,
  ctx: ExecutorContext
) {
  return runGroundedReport(
    "risk_analysis",
    `Risk Analysis — ${new Date().toLocaleDateString()}`,
    args,
    ctx
  );
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
  list_ceo_memories: listCeoMemories,
  list_executive_reports: listExecutiveReports,
  get_executive_report: getExecutiveReport,
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
  remember_ceo_insight: rememberCeoInsight,
  generate_executive_report: generateExecutiveReport,
  generate_strategic_plan: generateStrategicPlan,
  generate_risk_analysis: generateRiskAnalysis,
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

  await ensurePromptTemplatesSeeded();
  const agent = await ensureCeoAgent(organizationId);

  return {
    organizationId,
    userId: user.id,
    role: membership.role.key,
    agentId: agent.id,
  };
}
