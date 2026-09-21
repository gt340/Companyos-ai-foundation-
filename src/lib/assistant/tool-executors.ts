// src/lib/assistant/tool-executors.ts

import crypto from "crypto";
import OpenAI, { toFile } from "openai";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import { extractFromUrl, cleanText } from "@/lib/knowledge/extract-text";
import { processDocument } from "@/lib/knowledge/process-document";
import type { RoleKey, MemoryType, LeadStatus, DealStatus, SalesTaskStatus, CommunicationChannel } from "@prisma/client";

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
  salesAgentId: string; // this organization's Sales Agent record (Phase 7)
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

// ── Sales Agent foundation (Phase 7) ────────────────────────────────────

const SALES_PROMPT_TEMPLATES: {
  purpose: string;
  name: string;
  description: string;
  content: string;
}[] = [
  {
    purpose: "sales_system",
    name: "Sales Agent System Prompt",
    description: "Core identity and ground rules for the Sales Agent.",
    content:
      "You are the Sales Agent — an AI employee of this company responsible for helping generate and manage revenue, operating inside CompanyOS AI. You manage leads, contacts, deals, and the sales pipeline using only real CRM data actually provided to you — never invent a lead's details, a deal's value, or a customer's history. When information about a lead or deal is missing, say so plainly rather than guessing. You may draft outreach, follow-ups, quotations, and proposals, but sensitive external actions (sending anything to a real customer, changing a deal's value or stage in ways that affect reporting) require human approval before they take effect — you propose, a person approves. Think and communicate like a sharp, honest sales operations lead: direct, grounded in real pipeline data, and clear about what you don't know.",
  },
  {
    purpose: "lead_qualification",
    name: "Lead Qualification Prompt",
    description: "Grounded lead scoring and qualification.",
    content:
      "Assess the provided lead using only its actual recorded details (source, contact info, any notes, any linked company) and any relevant company/product context provided. Give a qualification judgment (qualified / not yet qualified / unqualified) and a 0-100 score, with your reasoning tied explicitly to what's actually known about the lead. If key qualifying information (budget, timeline, authority, need) isn't recorded, say so as a gap rather than assuming an answer.",
  },
  {
    purpose: "next_action",
    name: "Next Action Recommendation Prompt",
    description: "Grounded recommendation of the next sales action.",
    content:
      "Given the current state of a lead or deal (status, stage, history, notes, any communication log entries provided), recommend the single most useful next action a salesperson should take, with a one-sentence reason grounded in what's actually recorded. Do not recommend an action that assumes facts not provided.",
  },
  {
    purpose: "outreach_drafting",
    name: "Outreach Drafting Prompt",
    description: "Grounded personalized outreach message drafting.",
    content:
      "Draft a personalized outreach message to the given lead or contact, using only their actual recorded details and the company's real profile/product information provided as context. Keep it concise and genuine — do not invent shared history, mutual connections, or claims about the recipient's company that weren't provided.",
  },
  {
    purpose: "followup_drafting",
    name: "Follow-up Drafting Prompt",
    description: "Grounded follow-up message drafting.",
    content:
      "Draft a follow-up message continuing the real conversation history provided for this lead, contact, or deal. Reference only what was actually discussed or recorded — do not invent prior commitments, promises, or details not present in the provided history.",
  },
  {
    purpose: "quotation_generation",
    name: "Quotation Generation Prompt",
    description: "Grounded quotation drafting.",
    content:
      "Draft a quotation for the given deal using only its actual recorded value, line items, or product/service context provided. If pricing details are incomplete, clearly mark the gap rather than inventing numbers — never fabricate a price, discount, or line item.",
  },
  {
    purpose: "proposal_generation",
    name: "Proposal Generation Prompt",
    description: "Grounded proposal drafting.",
    content:
      "Draft a sales proposal for the given deal, grounded in the company's real product/service information, the lead or account's actual recorded needs, and any notes provided. State plainly where a stronger proposal would need more information than is currently available, rather than inventing customer requirements.",
  },
  {
    purpose: "conversation_summary",
    name: "Conversation Summary Prompt",
    description: "Grounded summarization of customer communication.",
    content:
      "Summarize the provided customer communication history factually and concisely — key points raised, any commitments made by either side, and any open questions. Do not add interpretation presented as fact; if the customer's intent is ambiguous from the text, say so.",
  },
  {
    purpose: "conversion_prediction",
    name: "Conversion Prediction Prompt",
    description: "Grounded likelihood-of-conversion assessment.",
    content:
      "Estimate the likelihood this deal converts (won), using only its actual stage, age, recorded value, and any communication/notes history provided. Give a confidence level and ground the reasoning explicitly in what's recorded — flag clearly if there isn't enough real signal to make a meaningful prediction, rather than producing a number without basis.",
  },
  {
    purpose: "lost_deal_analysis",
    name: "Lost Deal Analysis Prompt",
    description: "Grounded analysis of lost deals.",
    content:
      "Analyze the provided lost deal(s) using only their actual recorded lost reasons, stage history, and notes. Identify real patterns only if the data actually supports them (e.g. multiple deals citing the same recorded lost reason) — do not speculate about causes that weren't recorded.",
  },
  {
    purpose: "reactivation_recommendation",
    name: "Customer Reactivation Prompt",
    description: "Grounded identification of inactive leads/customers worth re-engaging.",
    content:
      "Given the provided list of leads or deals with their last-activity information, identify which are genuinely inactive (based on actual recorded dates, not assumption) and worth re-engaging, with a brief reason grounded in their real recorded history — prior interest, deal value, or past communication.",
  },
];

async function ensureSalesPromptTemplatesSeeded() {
  const count = await prisma.promptTemplate.count({ where: { agentType: "SALES" } });
  if (count >= SALES_PROMPT_TEMPLATES.length) return;

  for (const t of SALES_PROMPT_TEMPLATES) {
    await prisma.promptTemplate.upsert({
      where: {
        purpose_agentType_version: { purpose: t.purpose, agentType: "SALES", version: 1 },
      },
      update: {},
      create: {
        name: t.name,
        purpose: t.purpose,
        agentType: "SALES",
        description: t.description,
        content: t.content,
        version: 1,
        isActive: true,
      },
    });
  }
}

async function ensureSalesAgent(organizationId: string) {
  return prisma.agent.upsert({
    where: { organizationId_type: { organizationId, type: "SALES" } },
    update: {},
    create: { organizationId, type: "SALES", name: "Sales Agent" },
  });
}

const DEFAULT_PIPELINE_STAGES: { name: string; order: number; isWon: boolean; isLost: boolean }[] = [
  { name: "Prospecting", order: 0, isWon: false, isLost: false },
  { name: "Qualification", order: 1, isWon: false, isLost: false },
  { name: "Proposal", order: 2, isWon: false, isLost: false },
  { name: "Negotiation", order: 3, isWon: false, isLost: false },
  { name: "Won", order: 4, isWon: true, isLost: false },
  { name: "Lost", order: 5, isWon: false, isLost: true },
];

async function ensureDefaultPipelineStages(organizationId: string) {
  const count = await prisma.pipelineStage.count({ where: { organizationId } });
  if (count > 0) return;

  await prisma.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s) => ({ organizationId, ...s })),
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

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchWebViaTavily(
  query: string,
  maxResults: number
): Promise<WebSearchResult[] | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "basic",
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

async function searchWebViaSerper(
  query: string,
  maxResults: number
): Promise<WebSearchResult[] | null> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query }),
  });

  if (!res.ok) {
    throw new Error(`Serper search failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const organic = (data.organic ?? []).slice(0, maxResults);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return organic.map((r: any) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet ?? "",
  }));
}

// Tries Tavily first (purpose-built for AI agent use, usually cleaner
// results), falls back to Serper if Tavily's key is missing or the Tavily
// call itself errors. If neither key is configured, fails clearly rather
// than silently returning nothing.
async function searchWeb(
  args: { query: string; maxResults?: number },
  _ctx: ExecutorContext
) {
  const maxResults = Math.min(args.maxResults ?? 5, 10);

  let results: WebSearchResult[] | null = null;
  let tavilyError: string | null = null;

  try {
    results = await searchWebViaTavily(args.query, maxResults);
  } catch (err) {
    tavilyError = err instanceof Error ? err.message : "Unknown Tavily error";
  }

  if (!results) {
    try {
      results = await searchWebViaSerper(args.query, maxResults);
    } catch (err) {
      const serperError =
        err instanceof Error ? err.message : "Unknown Serper error";
      throw new Error(
        tavilyError
          ? `Web search failed on both providers. Tavily: ${tavilyError}. Serper: ${serperError}`
          : `Web search failed: ${serperError}`
      );
    }
  }

  if (!results) {
    throw new Error(
      "Web search isn't configured yet — neither TAVILY_API_KEY nor SERPER_API_KEY is set."
    );
  }

  return { query: args.query, results };
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

// ── SALES AGENT / CRM: approval + audit logging ─────────────────────────
// Every mutating Sales tool runs through this. Since the app's Confirm
// card IS the approval step (no separate multi-person approval queue
// exists yet), the ApprovalRequest row is created already APPROVED at the
// moment of confirmation, then flipped to EXECUTED/FAILED with the real
// result — giving genuine queryable history rather than just the
// transient in-memory Confirm-card state.
async function withSalesApproval<T>(
  ctx: ExecutorContext,
  actionType: string,
  proposedAction: unknown,
  run: () => Promise<T>
): Promise<T> {
  const approval = await prisma.approvalRequest.create({
    data: {
      organizationId: ctx.organizationId,
      agentId: ctx.salesAgentId,
      actionType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      proposedAction: proposedAction as any,
      status: "APPROVED",
      requestedBy: ctx.userId,
      reviewedBy: ctx.userId,
    },
  });

  try {
    const result = await run();
    await prisma.approvalRequest.update({
      where: { id: approval.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { status: "EXECUTED", result: result as any },
    });
    await logSalesAction(ctx, actionType, proposedAction, result, "EXECUTED", "success");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { status: "FAILED", result: { error: message } },
    });
    await logSalesAction(ctx, actionType, proposedAction, null, "FAILED", message);
    throw err;
  }
}

// Every Sales Agent action — read or write — gets an AgentActionLog row,
// per the audit requirement (agent, action, time, reason, input, output,
// approval, result). Read-only lookups pass approvalStatus null (nothing
// to approve) and a short result summary.
async function logSalesAction(
  ctx: ExecutorContext,
  action: string,
  input: unknown,
  output: unknown,
  approvalStatus: "EXECUTED" | "FAILED" | null,
  result: string
) {
  try {
    await prisma.agentActionLog.create({
      data: {
        organizationId: ctx.organizationId,
        agentId: ctx.salesAgentId,
        action,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: (input ?? {}) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        output: (output ?? null) as any,
        approvalStatus: approvalStatus ?? undefined,
        result,
      },
    });
  } catch {
    // Audit logging is best-effort — never let a logging failure break
    // the actual tool call.
  }
}

async function resolveStageId(
  organizationId: string,
  stageName?: string,
  fallbackToFirst = true
): Promise<string> {
  if (stageName) {
    const stage = await prisma.pipelineStage.findFirst({
      where: { organizationId, name: { equals: stageName, mode: "insensitive" } },
    });
    if (!stage) throw new Error(`No pipeline stage named "${stageName}" exists.`);
    return stage.id;
  }
  if (!fallbackToFirst) throw new Error("A stage name is required.");
  const first = await prisma.pipelineStage.findFirst({
    where: { organizationId },
    orderBy: { order: "asc" },
  });
  if (!first) throw new Error("No pipeline stages are set up for this organization.");
  return first.id;
}

// ── SALES AGENT / CRM: read-only executors ──────────────────────────────

async function getSalesPipelineSummary(_args: unknown, ctx: ExecutorContext) {
  const [leadsByStatus, deals, wonCount, lostCount, followUpsDue] = await Promise.all([
    prisma.lead.groupBy({
      by: ["status"],
      where: { organizationId: ctx.organizationId },
      _count: true,
    }),
    prisma.deal.findMany({
      where: { organizationId: ctx.organizationId },
      select: { value: true, status: true, pipelineStageId: true },
    }),
    prisma.deal.count({ where: { organizationId: ctx.organizationId, status: "WON" } }),
    prisma.deal.count({ where: { organizationId: ctx.organizationId, status: "LOST" } }),
    prisma.followUp.count({
      where: { organizationId: ctx.organizationId, completed: false, dueDate: { lte: new Date() } },
    }),
  ]);

  const totalLeads = leadsByStatus.reduce((sum, g) => sum + g._count, 0);
  const openDeals = deals.filter((d) => d.status === "OPEN");
  const pipelineValue = openDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
  const wonDeals = deals.filter((d) => d.status === "WON");
  const revenueGenerated = wonDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
  const closedCount = wonCount + lostCount;
  const conversionRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : null;

  const result = {
    totalLeads,
    newLeads: leadsByStatus.find((g) => g.status === "NEW")?._count ?? 0,
    qualifiedLeads: leadsByStatus.find((g) => g.status === "QUALIFIED")?._count ?? 0,
    activeDeals: openDeals.length,
    wonDeals: wonCount,
    lostDeals: lostCount,
    conversionRatePercent: conversionRate,
    pipelineValue,
    revenueGenerated,
    followUpsDue,
    note: conversionRate === null ? "No closed deals yet — conversion rate not meaningful." : undefined,
  };

  await logSalesAction(ctx, "get_sales_pipeline_summary", {}, result, null, "summary generated");
  return result;
}

async function getPipelineStages(_args: unknown, ctx: ExecutorContext) {
  return prisma.pipelineStage.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { order: "asc" },
  });
}

async function listCrmCompanies(args: { limit?: number }, ctx: ExecutorContext) {
  return prisma.crmCompany.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 20,
  });
}

async function listContacts(
  args: { crmCompanyId?: string; leadId?: string; limit?: number },
  ctx: ExecutorContext
) {
  return prisma.contact.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(args.crmCompanyId ? { crmCompanyId: args.crmCompanyId } : {}),
      ...(args.leadId ? { leadId: args.leadId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 20,
  });
}

async function listLeads(args: { status?: string; limit?: number }, ctx: ExecutorContext) {
  return prisma.lead.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(args.status ? { status: args.status.toUpperCase() as LeadStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 20,
  });
}

async function getLead(args: { leadId: string }, ctx: ExecutorContext) {
  const lead = await prisma.lead.findFirst({
    where: { id: args.leadId, organizationId: ctx.organizationId },
    include: {
      contacts: true,
      deals: true,
      salesTasks: true,
      followUps: true,
      communicationLogs: { orderBy: { occurredAt: "desc" }, take: 10 },
      crmCompany: true,
    },
  });
  if (!lead) throw new Error("Lead not found in this organization.");
  return lead;
}

async function listDeals(
  args: { stageName?: string; status?: string; limit?: number },
  ctx: ExecutorContext
) {
  const stageId = args.stageName
    ? await resolveStageId(ctx.organizationId, args.stageName, false)
    : undefined;

  return prisma.deal.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(stageId ? { pipelineStageId: stageId } : {}),
      ...(args.status ? { status: args.status.toUpperCase() as DealStatus } : {}),
    },
    include: { pipelineStage: true },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 20,
  });
}

async function getDeal(args: { dealId: string }, ctx: ExecutorContext) {
  const deal = await prisma.deal.findFirst({
    where: { id: args.dealId, organizationId: ctx.organizationId },
    include: {
      pipelineStage: true,
      salesTasks: true,
      followUps: true,
      communicationLogs: { orderBy: { occurredAt: "desc" }, take: 10 },
      salesDocuments: true,
      crmCompany: true,
      contact: true,
      lead: true,
    },
  });
  if (!deal) throw new Error("Deal not found in this organization.");
  return deal;
}

async function listSalesTasks(args: { status?: string; limit?: number }, ctx: ExecutorContext) {
  return prisma.salesTask.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(args.status ? { status: args.status.toUpperCase() as SalesTaskStatus } : {}),
    },
    orderBy: { dueDate: "asc" },
    take: args.limit ?? 20,
  });
}

async function listFollowUps(
  args: { includeCompleted?: boolean; limit?: number },
  ctx: ExecutorContext
) {
  return prisma.followUp.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(args.includeCompleted ? {} : { completed: false }),
    },
    orderBy: { dueDate: "asc" },
    take: args.limit ?? 20,
  });
}

async function listCommunicationLogs(
  args: { leadId?: string; dealId?: string; contactId?: string; limit?: number },
  ctx: ExecutorContext
) {
  return prisma.communicationLog.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(args.leadId ? { leadId: args.leadId } : {}),
      ...(args.dealId ? { dealId: args.dealId } : {}),
      ...(args.contactId ? { contactId: args.contactId } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: args.limit ?? 20,
  });
}

// ── SALES AGENT / CRM: mutating executors (approval + audit wrapped) ───

async function createCrmCompany(
  args: {
    name: string;
    industry?: string;
    website?: string;
    email?: string;
    phone?: string;
    size?: string;
    notes?: string;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "create_crm_company", args, () =>
    prisma.crmCompany.create({ data: { organizationId: ctx.organizationId, ...args } })
  );
}

async function updateCrmCompany(
  args: {
    crmCompanyId: string;
    industry?: string;
    website?: string;
    email?: string;
    phone?: string;
    size?: string;
    notes?: string;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "update_crm_company", args, async () => {
    const existing = await prisma.crmCompany.findFirst({
      where: { id: args.crmCompanyId, organizationId: ctx.organizationId },
    });
    if (!existing) throw new Error("CRM company not found in this organization.");

    const { crmCompanyId, ...updates } = args;
    return prisma.crmCompany.update({
      where: { id: crmCompanyId },
      data: updates,
    });
  });
}

async function createContact(
  args: {
    name: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    crmCompanyId?: string;
    leadId?: string;
    notes?: string;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "create_contact", args, () =>
    prisma.contact.create({ data: { organizationId: ctx.organizationId, ...args } })
  );
}

async function createLead(
  args: {
    name: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    source?: string;
    crmCompanyId?: string;
    notes?: string;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "create_lead", args, () =>
    prisma.lead.create({ data: { organizationId: ctx.organizationId, ...args } })
  );
}

async function updateLead(
  args: {
    leadId: string;
    status?: string;
    score?: number;
    aiConfidenceScore?: number;
    notes?: string;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "update_lead", args, async () => {
    const existing = await prisma.lead.findFirst({
      where: { id: args.leadId, organizationId: ctx.organizationId },
    });
    if (!existing) throw new Error("Lead not found in this organization.");

    return prisma.lead.update({
      where: { id: args.leadId },
      data: {
        ...(args.status ? { status: args.status.toUpperCase() as LeadStatus } : {}),
        ...(args.score !== undefined ? { score: args.score } : {}),
        ...(args.aiConfidenceScore !== undefined ? { aiConfidenceScore: args.aiConfidenceScore } : {}),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
      },
    });
  });
}

async function convertLeadToDeal(
  args: {
    leadId: string;
    dealTitle: string;
    value?: number;
    currency?: string;
    expectedCloseDate?: string;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "convert_lead_to_deal", args, async () => {
    const lead = await prisma.lead.findFirst({
      where: { id: args.leadId, organizationId: ctx.organizationId },
    });
    if (!lead) throw new Error("Lead not found in this organization.");

    const stageId = await resolveStageId(ctx.organizationId);

    const deal = await prisma.deal.create({
      data: {
        organizationId: ctx.organizationId,
        title: args.dealTitle,
        leadId: lead.id,
        crmCompanyId: lead.crmCompanyId,
        pipelineStageId: stageId,
        value: args.value,
        currency: args.currency ?? "USD",
        expectedCloseDate: args.expectedCloseDate ? new Date(args.expectedCloseDate) : undefined,
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "CONVERTED" },
    });

    return deal;
  });
}

async function createDeal(
  args: {
    title: string;
    value?: number;
    currency?: string;
    crmCompanyId?: string;
    contactId?: string;
    stageName?: string;
    expectedCloseDate?: string;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "create_deal", args, async () => {
    const stageId = await resolveStageId(ctx.organizationId, args.stageName);
    return prisma.deal.create({
      data: {
        organizationId: ctx.organizationId,
        title: args.title,
        value: args.value,
        currency: args.currency ?? "USD",
        crmCompanyId: args.crmCompanyId,
        contactId: args.contactId,
        pipelineStageId: stageId,
        expectedCloseDate: args.expectedCloseDate ? new Date(args.expectedCloseDate) : undefined,
      },
    });
  });
}

async function updateDeal(
  args: {
    dealId: string;
    stageName?: string;
    value?: number;
    expectedCloseDate?: string;
    lostReason?: string;
    aiConfidenceScore?: number;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "update_deal", args, async () => {
    const existing = await prisma.deal.findFirst({
      where: { id: args.dealId, organizationId: ctx.organizationId },
    });
    if (!existing) throw new Error("Deal not found in this organization.");

    let stageUpdate: { pipelineStageId?: string; status?: DealStatus; actualCloseDate?: Date } = {};
    if (args.stageName) {
      const stage = await prisma.pipelineStage.findFirst({
        where: { organizationId: ctx.organizationId, name: { equals: args.stageName, mode: "insensitive" } },
      });
      if (!stage) throw new Error(`No pipeline stage named "${args.stageName}" exists.`);
      if (stage.isLost && !args.lostReason) {
        throw new Error("Moving a deal to a lost stage requires a lostReason.");
      }
      stageUpdate = {
        pipelineStageId: stage.id,
        status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
        actualCloseDate: stage.isWon || stage.isLost ? new Date() : undefined,
      };
    }

    return prisma.deal.update({
      where: { id: args.dealId },
      data: {
        ...stageUpdate,
        ...(args.value !== undefined ? { value: args.value } : {}),
        ...(args.expectedCloseDate ? { expectedCloseDate: new Date(args.expectedCloseDate) } : {}),
        ...(args.lostReason ? { lostReason: args.lostReason } : {}),
        ...(args.aiConfidenceScore !== undefined ? { aiConfidenceScore: args.aiConfidenceScore } : {}),
      },
    });
  });
}

async function createSalesTask(
  args: { title: string; description?: string; dueDate?: string; dealId?: string; leadId?: string },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "create_sales_task", args, () =>
    prisma.salesTask.create({
      data: {
        organizationId: ctx.organizationId,
        title: args.title,
        description: args.description,
        dueDate: args.dueDate ? new Date(args.dueDate) : undefined,
        dealId: args.dealId,
        leadId: args.leadId,
        createdBy: ctx.userId,
      },
    })
  );
}

async function updateSalesTaskStatus(
  args: { taskId: string; status: string },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "update_sales_task_status", args, async () => {
    const existing = await prisma.salesTask.findFirst({
      where: { id: args.taskId, organizationId: ctx.organizationId },
    });
    if (!existing) throw new Error("Sales task not found in this organization.");
    return prisma.salesTask.update({
      where: { id: args.taskId },
      data: { status: args.status.toUpperCase() as SalesTaskStatus },
    });
  });
}

async function createFollowUp(
  args: { dueDate: string; notes?: string; leadId?: string; dealId?: string; contactId?: string },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "create_follow_up", args, () =>
    prisma.followUp.create({
      data: {
        organizationId: ctx.organizationId,
        dueDate: new Date(args.dueDate),
        notes: args.notes,
        leadId: args.leadId,
        dealId: args.dealId,
        contactId: args.contactId,
        createdBy: ctx.userId,
      },
    })
  );
}

async function completeFollowUp(args: { followUpId: string }, ctx: ExecutorContext) {
  return withSalesApproval(ctx, "complete_follow_up", args, async () => {
    const existing = await prisma.followUp.findFirst({
      where: { id: args.followUpId, organizationId: ctx.organizationId },
    });
    if (!existing) throw new Error("Follow-up not found in this organization.");
    return prisma.followUp.update({
      where: { id: args.followUpId },
      data: { completed: true },
    });
  });
}

async function logCommunication(
  args: {
    channel: string;
    content: string;
    direction?: string;
    leadId?: string;
    dealId?: string;
    contactId?: string;
  },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "log_communication", args, () =>
    prisma.communicationLog.create({
      data: {
        organizationId: ctx.organizationId,
        channel: args.channel.toUpperCase() as CommunicationChannel,
        content: args.content,
        direction: args.direction?.toUpperCase(),
        leadId: args.leadId,
        dealId: args.dealId,
        contactId: args.contactId,
        createdBy: ctx.userId,
      },
    })
  );
}

async function deleteLead(args: { leadId: string }, ctx: ExecutorContext) {
  return withSalesApproval(ctx, "delete_lead", args, async () => {
    const existing = await prisma.lead.findFirst({
      where: { id: args.leadId, organizationId: ctx.organizationId },
    });
    if (!existing) throw new Error("Lead not found in this organization.");
    await prisma.lead.delete({ where: { id: args.leadId } });
    return { deleted: true, leadId: args.leadId, name: existing.name };
  });
}

// ── SALES AGENT: AI capability tools ────────────────────────────────────
// Shared helper: every capability below follows the same shape — load the
// sales_system + one purpose-specific PromptTemplate, hand the model only
// real data pulled from the CRM, and return its response as plain text
// (not JSON mode — these are advisory/drafting outputs, not structured
// reports). Grounding discipline (never invent, flag gaps) lives in the
// template content itself, seeded back in ensureSalesPromptTemplatesSeeded.
async function runSalesAiPrompt(
  templatePurpose: string,
  contextText: string,
  extraInstruction?: string
): Promise<string> {
  const [systemTemplate, promptTemplate] = await Promise.all([
    prisma.promptTemplate.findFirst({
      where: { purpose: "sales_system", agentType: "SALES", isActive: true },
    }),
    prisma.promptTemplate.findFirst({
      where: { purpose: templatePurpose, agentType: "SALES", isActive: true },
    }),
  ]);

  if (!promptTemplate) {
    throw new Error(`The "${templatePurpose}" prompt template isn't set up yet.`);
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemTemplate?.content ?? "You are the Sales Agent." },
      {
        role: "user",
        content: `${promptTemplate.content}\n\n${
          extraInstruction ? `ADDITIONAL INSTRUCTION FROM THE USER: ${extraInstruction}\n\n` : ""
        }REAL RECORDED DATA (do not go beyond this):\n${contextText}`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("The model returned no content.");
  return text;
}

function formatLeadContext(lead: {
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  source: string | null;
  status: string;
  score: number;
  notes: string | null;
}): string {
  return [
    `Lead name: ${lead.name}`,
    `Email: ${lead.email ?? "Not recorded"}`,
    `Phone: ${lead.phone ?? "Not recorded"}`,
    `Job title: ${lead.jobTitle ?? "Not recorded"}`,
    `Source: ${lead.source ?? "Not recorded"}`,
    `Status: ${lead.status}`,
    `Current score: ${lead.score}`,
    `Notes: ${lead.notes ?? "None"}`,
  ].join("\n");
}

async function qualifyLead(args: { leadId: string }, ctx: ExecutorContext) {
  const lead = await prisma.lead.findFirst({
    where: { id: args.leadId, organizationId: ctx.organizationId },
    include: { crmCompany: true },
  });
  if (!lead) throw new Error("Lead not found in this organization.");

  const contextText = [
    formatLeadContext(lead),
    lead.crmCompany
      ? `Company: ${lead.crmCompany.name} (${lead.crmCompany.industry ?? "industry not recorded"})`
      : "No linked CRM company.",
  ].join("\n");

  const analysis = await runSalesAiPrompt("lead_qualification", contextText);
  await logSalesAction(ctx, "qualify_lead", args, { analysis }, null, "analysis generated");
  return { leadId: lead.id, leadName: lead.name, analysis };
}

async function recommendNextAction(
  args: { leadId?: string; dealId?: string },
  ctx: ExecutorContext
) {
  if (!args.leadId && !args.dealId) throw new Error("Provide either a leadId or a dealId.");

  let contextText: string;
  if (args.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: args.leadId, organizationId: ctx.organizationId },
      include: {
        salesTasks: true,
        followUps: { where: { completed: false } },
        communicationLogs: { orderBy: { occurredAt: "desc" }, take: 5 },
      },
    });
    if (!lead) throw new Error("Lead not found in this organization.");
    contextText = [
      formatLeadContext(lead),
      `Open tasks: ${lead.salesTasks.filter((t) => t.status !== "DONE").length}`,
      `Pending follow-ups: ${lead.followUps.length}`,
      `Recent communications: ${lead.communicationLogs.map((c) => `[${c.channel}] ${c.content}`).join(" | ") || "None"}`,
    ].join("\n");
  } else {
    const deal = await prisma.deal.findFirst({
      where: { id: args.dealId, organizationId: ctx.organizationId },
      include: {
        pipelineStage: true,
        followUps: { where: { completed: false } },
        communicationLogs: { orderBy: { occurredAt: "desc" }, take: 5 },
      },
    });
    if (!deal) throw new Error("Deal not found in this organization.");
    contextText = [
      `Deal: ${deal.title}`,
      `Stage: ${deal.pipelineStage?.name ?? "Unknown"}`,
      `Value: ${deal.value ?? "Not recorded"} ${deal.currency}`,
      `Status: ${deal.status}`,
      `Expected close: ${deal.expectedCloseDate?.toISOString() ?? "Not set"}`,
      `Pending follow-ups: ${deal.followUps.length}`,
      `Recent communications: ${deal.communicationLogs.map((c) => `[${c.channel}] ${c.content}`).join(" | ") || "None"}`,
    ].join("\n");
  }

  const analysis = await runSalesAiPrompt("next_action", contextText);
  await logSalesAction(ctx, "recommend_next_action", args, { analysis }, null, "recommendation generated");
  return { analysis };
}

async function draftOutreachMessage(
  args: { leadId?: string; contactId?: string; tone?: string },
  ctx: ExecutorContext
) {
  if (!args.leadId && !args.contactId) throw new Error("Provide either a leadId or a contactId.");

  let contextText: string;
  if (args.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: args.leadId, organizationId: ctx.organizationId },
      include: { crmCompany: true },
    });
    if (!lead) throw new Error("Lead not found in this organization.");
    contextText = formatLeadContext(lead);
  } else {
    const contact = await prisma.contact.findFirst({
      where: { id: args.contactId, organizationId: ctx.organizationId },
      include: { crmCompany: true },
    });
    if (!contact) throw new Error("Contact not found in this organization.");
    contextText = [
      `Contact name: ${contact.name}`,
      `Email: ${contact.email ?? "Not recorded"}`,
      `Job title: ${contact.jobTitle ?? "Not recorded"}`,
      contact.crmCompany ? `Company: ${contact.crmCompany.name}` : "No linked company.",
    ].join("\n");
  }

  const message = await runSalesAiPrompt("outreach_drafting", contextText, args.tone ? `Tone: ${args.tone}` : undefined);
  await logSalesAction(ctx, "draft_outreach_message", args, { message }, null, "draft generated");
  return { message };
}

async function draftFollowupMessage(
  args: { leadId?: string; dealId?: string; contactId?: string },
  ctx: ExecutorContext
) {
  const logs = await prisma.communicationLog.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(args.leadId ? { leadId: args.leadId } : {}),
      ...(args.dealId ? { dealId: args.dealId } : {}),
      ...(args.contactId ? { contactId: args.contactId } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: 10,
  });

  const contextText = logs.length
    ? logs.map((l) => `[${l.occurredAt.toISOString()}] [${l.channel}] ${l.content}`).join("\n")
    : "No prior communication history recorded.";

  const message = await runSalesAiPrompt("followup_drafting", contextText);
  await logSalesAction(ctx, "draft_followup_message", args, { message }, null, "draft generated");
  return { message };
}

async function generateQuotation(
  args: { dealId: string; lineItemsNote?: string },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "generate_quotation", args, async () => {
    const deal = await prisma.deal.findFirst({
      where: { id: args.dealId, organizationId: ctx.organizationId },
      include: { crmCompany: true, contact: true },
    });
    if (!deal) throw new Error("Deal not found in this organization.");

    const contextText = [
      `Deal: ${deal.title}`,
      `Value: ${deal.value ?? "Not recorded"} ${deal.currency}`,
      deal.crmCompany ? `Company: ${deal.crmCompany.name}` : "No linked company.",
      deal.contact ? `Contact: ${deal.contact.name}` : "No linked contact.",
    ].join("\n");

    const content = await runSalesAiPrompt("quotation_generation", contextText, args.lineItemsNote);

    return prisma.salesDocument.create({
      data: {
        organizationId: ctx.organizationId,
        dealId: deal.id,
        kind: "QUOTATION",
        title: `Quotation — ${deal.title}`,
        content,
        totalValue: deal.value,
        createdBy: ctx.userId,
      },
    });
  });
}

async function generateProposal(
  args: { dealId: string; focusNote?: string },
  ctx: ExecutorContext
) {
  return withSalesApproval(ctx, "generate_proposal", args, async () => {
    const [deal, company] = await Promise.all([
      prisma.deal.findFirst({
        where: { id: args.dealId, organizationId: ctx.organizationId },
        include: { crmCompany: true, contact: true },
      }),
      prisma.company.findUnique({ where: { organizationId: ctx.organizationId } }),
    ]);
    if (!deal) throw new Error("Deal not found in this organization.");

    const contextText = [
      `Deal: ${deal.title}`,
      `Value: ${deal.value ?? "Not recorded"} ${deal.currency}`,
      deal.crmCompany ? `Prospect company: ${deal.crmCompany.name}` : "No linked company.",
      deal.contact ? `Contact: ${deal.contact.name}` : "No linked contact.",
      company
        ? `Our products: ${company.products.join("; ") || "Not set"}\nOur services: ${company.services.join("; ") || "Not set"}\nOur mission: ${company.mission ?? "Not set"}`
        : "Our own company profile is not filled in yet.",
    ].join("\n");

    const content = await runSalesAiPrompt("proposal_generation", contextText, args.focusNote);

    return prisma.salesDocument.create({
      data: {
        organizationId: ctx.organizationId,
        dealId: deal.id,
        kind: "PROPOSAL",
        title: `Proposal — ${deal.title}`,
        content,
        totalValue: deal.value,
        createdBy: ctx.userId,
      },
    });
  });
}

async function summarizeConversation(
  args: { leadId?: string; dealId?: string; contactId?: string },
  ctx: ExecutorContext
) {
  const logs = await prisma.communicationLog.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(args.leadId ? { leadId: args.leadId } : {}),
      ...(args.dealId ? { dealId: args.dealId } : {}),
      ...(args.contactId ? { contactId: args.contactId } : {}),
    },
    orderBy: { occurredAt: "asc" },
  });

  if (logs.length === 0) {
    return { summary: "No communication has been logged for this yet — nothing to summarize." };
  }

  const contextText = logs
    .map((l) => `[${l.occurredAt.toISOString()}] [${l.channel}${l.direction ? `/${l.direction}` : ""}] ${l.content}`)
    .join("\n");

  const summary = await runSalesAiPrompt("conversation_summary", contextText);
  await logSalesAction(ctx, "summarize_conversation", args, { summary }, null, "summary generated");
  return { summary };
}

async function predictConversion(args: { dealId: string }, ctx: ExecutorContext) {
  const deal = await prisma.deal.findFirst({
    where: { id: args.dealId, organizationId: ctx.organizationId },
    include: {
      pipelineStage: true,
      communicationLogs: { orderBy: { occurredAt: "desc" }, take: 10 },
    },
  });
  if (!deal) throw new Error("Deal not found in this organization.");

  const ageDays = Math.round((Date.now() - deal.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const contextText = [
    `Deal: ${deal.title}`,
    `Stage: ${deal.pipelineStage?.name ?? "Unknown"}`,
    `Value: ${deal.value ?? "Not recorded"} ${deal.currency}`,
    `Age: ${ageDays} days since created`,
    `Expected close: ${deal.expectedCloseDate?.toISOString() ?? "Not set"}`,
    `Prior AI confidence recorded: ${deal.aiConfidenceScore ?? "None yet"}`,
    `Communication count: ${deal.communicationLogs.length}`,
    `Recent communications: ${deal.communicationLogs.map((c) => `[${c.channel}] ${c.content}`).join(" | ") || "None"}`,
  ].join("\n");

  const analysis = await runSalesAiPrompt("conversion_prediction", contextText);
  await logSalesAction(ctx, "predict_conversion", args, { analysis }, null, "prediction generated");
  return { dealId: deal.id, dealTitle: deal.title, analysis };
}

async function analyzeLostDeals(args: { limit?: number }, ctx: ExecutorContext) {
  const lostDeals = await prisma.deal.findMany({
    where: { organizationId: ctx.organizationId, status: "LOST" },
    orderBy: { actualCloseDate: "desc" },
    take: args.limit ?? 10,
  });

  if (lostDeals.length === 0) {
    return { analysis: "No lost deals recorded yet — nothing to analyze." };
  }

  const contextText = lostDeals
    .map(
      (d) =>
        `Deal: ${d.title} | Value: ${d.value ?? "Not recorded"} ${d.currency} | Lost reason: ${
          d.lostReason ?? "Not recorded"
        } | Closed: ${d.actualCloseDate?.toISOString() ?? "Unknown"}`
    )
    .join("\n");

  const analysis = await runSalesAiPrompt("lost_deal_analysis", contextText);
  await logSalesAction(ctx, "analyze_lost_deals", args, { analysis }, null, "analysis generated");
  return { dealsAnalyzed: lostDeals.length, analysis };
}

async function findReactivationCandidates(
  args: { inactiveDays?: number },
  ctx: ExecutorContext
) {
  const cutoff = new Date(Date.now() - (args.inactiveDays ?? 30) * 24 * 60 * 60 * 1000);

  const [staleLeads, staleDeals] = await Promise.all([
    prisma.lead.findMany({
      where: {
        organizationId: ctx.organizationId,
        status: { notIn: ["CONVERTED", "LOST", "UNQUALIFIED"] },
        updatedAt: { lte: cutoff },
      },
      take: 20,
    }),
    prisma.deal.findMany({
      where: { organizationId: ctx.organizationId, status: "OPEN", updatedAt: { lte: cutoff } },
      take: 20,
    }),
  ]);

  if (staleLeads.length === 0 && staleDeals.length === 0) {
    return { analysis: `No leads or open deals have gone ${args.inactiveDays ?? 30}+ days without an update.` };
  }

  const contextText = [
    staleLeads.length
      ? `Inactive leads:\n${staleLeads.map((l) => `- ${l.name} (status ${l.status}, last updated ${l.updatedAt.toISOString()})`).join("\n")}`
      : "No inactive leads.",
    staleDeals.length
      ? `Inactive open deals:\n${staleDeals.map((d) => `- ${d.title} (value ${d.value ?? "not recorded"}, last updated ${d.updatedAt.toISOString()})`).join("\n")}`
      : "No inactive open deals.",
  ].join("\n\n");

  const analysis = await runSalesAiPrompt("reactivation_recommendation", contextText);
  await logSalesAction(ctx, "find_reactivation_candidates", args, { analysis }, null, "candidates identified");
  return { leadCount: staleLeads.length, dealCount: staleDeals.length, analysis };
}

// ── CEO ↔ Sales Agent collaboration ─────────────────────────────────────
// Deliberately reuses AgentMemory rather than a new table: both agents
// are already Agent rows, each with their own memory scope. A "message"
// is just a memory entry on the RECEIVING agent, tagged with where it
// came from — so it naturally surfaces in that agent's future
// list_ceo_memories/list_sales... lookups and gets pulled into reports
// the same way any other memory does. This is one unified assistant
// playing both roles in a single conversation (not two separately
// running AI instances messaging each other) — the tool models the
// hand-off pattern honestly within that real architecture.
async function sendAgentMessage(
  args: { toAgent: string; message: string; importance?: number },
  ctx: ExecutorContext
) {
  const toAgent = args.toAgent.toUpperCase();
  if (toAgent !== "CEO" && toAgent !== "SALES") {
    throw new Error(`toAgent must be 'CEO' or 'SALES', got "${args.toAgent}".`);
  }
  const fromAgent = toAgent === "CEO" ? "SALES" : "CEO";
  const targetAgentId = toAgent === "CEO" ? ctx.agentId : ctx.salesAgentId;

  const memory = await prisma.agentMemory.create({
    data: {
      organizationId: ctx.organizationId,
      agentId: targetAgentId,
      type: "BUSINESS_EVENT",
      content: args.message,
      importance: Math.min(5, Math.max(1, args.importance ?? 3)),
      sourceRef: `agent_message_from_${fromAgent}`,
      createdBy: ctx.userId,
    },
  });

  return { id: memory.id, toAgent, fromAgent, message: args.message };
}

async function listAgentMessages(
  args: { forAgent: string; limit?: number },
  ctx: ExecutorContext
) {
  const forAgent = args.forAgent.toUpperCase();
  if (forAgent !== "CEO" && forAgent !== "SALES") {
    throw new Error(`forAgent must be 'CEO' or 'SALES', got "${args.forAgent}".`);
  }
  const targetAgentId = forAgent === "CEO" ? ctx.agentId : ctx.salesAgentId;

  const messages = await prisma.agentMemory.findMany({
    where: {
      organizationId: ctx.organizationId,
      agentId: targetAgentId,
      sourceRef: { startsWith: "agent_message_from_" },
    },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 10,
  });

  return messages.map((m) => ({
    id: m.id,
    from: m.sourceRef?.replace("agent_message_from_", ""),
    content: m.content,
    importance: m.importance,
    createdAt: m.createdAt,
  }));
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
  search_web: searchWeb,
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

  // Sales Agent / CRM (Phase 7)
  get_sales_pipeline_summary: getSalesPipelineSummary,
  get_pipeline_stages: getPipelineStages,
  list_crm_companies: listCrmCompanies,
  list_contacts: listContacts,
  list_leads: listLeads,
  get_lead: getLead,
  list_deals: listDeals,
  get_deal: getDeal,
  list_sales_tasks: listSalesTasks,
  list_follow_ups: listFollowUps,
  list_communication_logs: listCommunicationLogs,
  create_crm_company: createCrmCompany,
  update_crm_company: updateCrmCompany,
  create_contact: createContact,
  create_lead: createLead,
  update_lead: updateLead,
  convert_lead_to_deal: convertLeadToDeal,
  create_deal: createDeal,
  update_deal: updateDeal,
  create_sales_task: createSalesTask,
  update_sales_task_status: updateSalesTaskStatus,
  create_follow_up: createFollowUp,
  complete_follow_up: completeFollowUp,
  log_communication: logCommunication,
  delete_lead: deleteLead,
  qualify_lead: qualifyLead,
  recommend_next_action: recommendNextAction,
  draft_outreach_message: draftOutreachMessage,
  draft_followup_message: draftFollowupMessage,
  generate_quotation: generateQuotation,
  generate_proposal: generateProposal,
  summarize_conversation: summarizeConversation,
  predict_conversion: predictConversion,
  analyze_lost_deals: analyzeLostDeals,
  find_reactivation_candidates: findReactivationCandidates,
  send_agent_message: sendAgentMessage,
  list_agent_messages: listAgentMessages,
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

  await ensureSalesPromptTemplatesSeeded();
  const salesAgent = await ensureSalesAgent(organizationId);
  await ensureDefaultPipelineStages(organizationId);

  return {
    organizationId,
    userId: user.id,
    role: membership.role.key,
    agentId: agent.id,
    salesAgentId: salesAgent.id,
  };
}
