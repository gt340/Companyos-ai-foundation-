// src/lib/assistant/tools.ts

export interface AssistantTool {
  name: string;
  description: string;
  mutating: boolean;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const ASSISTANT_TOOLS: AssistantTool[] = [
  // ── READ-ONLY TOOLS (auto-execute inline) ──────────────────────────

  {
    name: "search_knowledge_base",
    description:
      "Semantic search over the organization's uploaded knowledge base documents (PDFs, Word, Excel, PowerPoint, images, audio/video transcripts, website URLs already ingested). Use this whenever the user asks a question that might be answered by company documents that have already been added. This does NOT search the live internet — use search_web for that.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query, in natural language.",
        },
        limit: {
          type: "number",
          description: "Max number of chunks to return. Defaults to 5.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_web",
    description:
      "Search the live internet for current, external information — market research, competitor information, industry news, general facts not covered by the company's own knowledge base. Use this when the user asks you to search online, look something up, or research a topic outside the company's own documents. Returns a list of results with titles, URLs, and short snippets — not full page content. Does not change any company data, so it runs immediately without requiring confirmation.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The web search query, in natural language.",
        },
        maxResults: {
          type: "number",
          description: "Max number of results to return. Defaults to 5.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_documents",
    description:
      "List knowledge base documents for the current organization, optionally filtered by category or status.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional category filter (e.g. 'policy', 'contract', 'general').",
        },
        status: {
          type: "string",
          description:
            "Optional status filter: PENDING, EXTRACTING, TRANSCRIBING, CHUNKING, EMBEDDING, READY, or FAILED.",
        },
      },
    },
  },
  {
    name: "get_members",
    description:
      "List members of the current organization, including their role and join date.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_activity_logs",
    description:
      "Get recent activity/audit log entries for the current organization.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of log entries to return. Defaults to 20.",
        },
      },
    },
  },
  {
    name: "get_notifications",
    description:
      "Get the current user's recent notifications for this organization, including unread count.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_organization_settings",
    description:
      "Get the current organization's settings: name, slug, and security settings.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "generate_image",
    description:
      "Generate a new image (poster, banner, illustration, etc.) from a text description. Returns an image the user can view and download. Does not change any company data, so it runs immediately without requiring confirmation.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed description of the image to generate.",
        },
        size: {
          type: "string",
          description:
            "Image size: '1024x1024' (square), '1536x1024' (landscape, good for banners), or '1024x1536' (portrait, good for posters). Defaults to '1024x1024'.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "edit_image",
    description:
      "Edit the image the user just attached to this message (e.g. remove an object, change the background, adjust colors, add text). Only works when the user has attached an image in their current message — if no image is attached, this will fail. Does not change any company data, so it runs immediately without requiring confirmation.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Description of the edit to make to the attached image.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "list_executive_reports",
    description:
      "List previously generated executive reports (including strategic plans and risk analyses) for this organization, most recent first.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of reports to return. Defaults to 10.",
        },
      },
    },
  },
  {
    name: "get_executive_report",
    description:
      "Get the full content of a specific report (executive report, strategic plan, or risk analysis), including all its sections.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        reportId: {
          type: "string",
          description: "ID of the report to retrieve.",
        },
      },
      required: ["reportId"],
    },
  },
  {
    name: "list_ceo_memories",
    description:
      "List what the CEO Agent currently remembers about this company, optionally filtered by type. Use this before answering questions about past decisions, stated goals, or founder preferences.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Optional filter: 'company_fact', 'strategic_goal', 'founder_preference', 'decision', 'business_event', or 'insight'.",
        },
        limit: {
          type: "number",
          description: "Max number of memories to return. Defaults to 20.",
        },
      },
    },
  },
  {
    name: "remember_ceo_insight",
    description:
      "Save something important to the CEO Agent's persistent memory so it can be recalled in future conversations and used in reports. Use for company facts, strategic goals, founder preferences, decisions, business events, or insights the founder wants remembered long-term — including useful findings from a web search the founder wants kept. Does not change core company data, so it runs immediately without requiring confirmation.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Memory type: 'company_fact', 'strategic_goal', 'founder_preference', 'decision', 'business_event', or 'insight'.",
        },
        content: {
          type: "string",
          description: "The information to remember.",
        },
        importance: {
          type: "number",
          description: "1 (low) to 5 (critical). Defaults to 3.",
        },
      },
      required: ["type", "content"],
    },
  },

  // ── MUTATING TOOLS (require user confirmation before executing) ────

  {
    name: "invite_member",
    description:
      "Invite a new member to the current organization by email, with a specified role.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Email address of the person to invite.",
        },
        role: {
          type: "string",
          description: "Role to assign: 'admin', 'member', or 'viewer'.",
        },
      },
      required: ["email", "role"],
    },
  },
  {
    name: "change_member_role",
    description:
      "Change an existing organization member's role to Admin, Member, or Viewer. Identify the member by their email address. Cannot be used to make someone Owner — use initiate_ownership_transfer for that instead, which requires the recipient's acceptance.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Email of the existing member whose role to change.",
        },
        newRole: {
          type: "string",
          description: "New role: 'admin', 'member', or 'viewer'. Not 'owner'.",
        },
      },
      required: ["email", "newRole"],
    },
  },
  {
    name: "initiate_ownership_transfer",
    description:
      "Start a real transfer of organization ownership to another person by email. Only the CURRENT actual owner can do this. This does not immediately transfer ownership — it generates an acceptance link that the recipient must open and accept while signed in with that email. The current user remains the owner until the recipient accepts.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        targetEmail: {
          type: "string",
          description: "Email of the person who should become the new owner. They don't need to be an existing member.",
        },
      },
      required: ["targetEmail"],
    },
  },
  {
    name: "update_organization_name",
    description: "Update the current organization's display name and/or slug.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "New organization display name.",
        },
        slug: {
          type: "string",
          description: "New organization URL slug.",
        },
      },
    },
  },
  {
    name: "update_security_settings",
    description:
      "Update organization-level security settings (e.g. require 2FA for all members).",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        require2FA: {
          type: "boolean",
          description: "Whether to require 2FA for all members.",
        },
      },
    },
  },
  {
    name: "update_notification_settings",
    description:
      "Update organization-wide notification settings (whether to notify on new members or billing events).",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        notifyOnNewMember: { type: "boolean" },
        notifyOnBillingEvents: { type: "boolean" },
      },
    },
  },
  {
    name: "update_profile",
    description: "Update the current user's own profile (name).",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "New display name for the current user.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_knowledge_document",
    description:
      "Create a knowledge base document from a website URL (not for file uploads — those go through the upload UI). Use when the user asks the assistant to ingest a specific URL — for example, one found via search_web that they want kept permanently and made searchable.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The website URL to ingest." },
        category: {
          type: "string",
          description: "Category to file this document under.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "create_document_draft",
    description:
      "Write and add a new knowledge base document by generating its full text content directly (not from a URL or file — for that use create_knowledge_document). Use this when the user asks the assistant to draft a policy, training material, or any other document from scratch.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the document." },
        content: {
          type: "string",
          description: "The full document text to save.",
        },
        category: {
          type: "string",
          description:
            "Category: 'general', 'policy', 'contract', 'invoice', 'manual', or 'training'.",
        },
      },
      required: ["title", "content", "category"],
    },
  },
  {
    name: "update_document_content",
    description:
      "Replace the full text content of an existing knowledge base document with new AI-written or AI-edited content. This overwrites the document — there is no version history, so the old content cannot be recovered after this runs.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "ID of the document to update.",
        },
        content: {
          type: "string",
          description: "The new full document text, replacing the old content entirely.",
        },
      },
      required: ["documentId", "content"],
    },
  },
  {
    name: "delete_knowledge_document",
    description: "Delete a knowledge base document by its ID.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The ID of the document to delete.",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "generate_executive_report",
    description:
      "Generate a broad, structured executive report using only the company's actual profile, knowledge base, and CEO memory — never fabricates data. Sections for unavailable data sources (financials, sales, marketing, etc.) will say so explicitly rather than inventing numbers. The report is saved permanently and appears in the Executive Dashboard. For a report focused specifically on strategy, use generate_strategic_plan instead; for one focused on risk, use generate_risk_analysis.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Optional title for the report. Defaults to 'Executive Report — <date>'.",
        },
        reportingPeriod: {
          type: "string",
          description: "Optional label for the period this report covers, e.g. 'Q3 2026'.",
        },
        focusArea: {
          type: "string",
          description:
            "Optional: narrow the report to a specific topic the user asked about (e.g. 'our hiring plans', 'the Q3 product launch'), instead of a fully general report.",
        },
      },
    },
  },
  {
    name: "generate_strategic_plan",
    description:
      "Generate a structured strategic planning report — grounded only in the company's actual stated goals, mission, and known context (profile, knowledge base, CEO memory). Never invents goals or metrics the founder hasn't stated. Clearly flags where a solid plan would need information that isn't currently available. Saved permanently and appears in the Executive Dashboard alongside executive reports.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Optional title for the plan. Defaults to 'Strategic Plan — <date>'.",
        },
        reportingPeriod: {
          type: "string",
          description: "Optional label for the period this plan covers, e.g. 'Q3 2026'.",
        },
        focusArea: {
          type: "string",
          description:
            "Optional: what to focus the strategic plan on (e.g. 'expanding into a new market', 'our hiring roadmap'). If omitted, produces a general strategic overview.",
        },
      },
    },
  },
  {
    name: "generate_risk_analysis",
    description:
      "Generate a structured risk analysis — grounded only in what's actually known about the company (industry, stage, team size, stated goals, knowledge base, CEO memory). Never invents hypothetical financial or legal risks unconnected to real company data; clearly distinguishes a risk grounded in real company data from a general industry consideration raised for awareness. Saved permanently and appears in the Executive Dashboard alongside executive reports.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Optional title for the analysis. Defaults to 'Risk Analysis — <date>'.",
        },
        reportingPeriod: {
          type: "string",
          description: "Optional label for the period this analysis covers, e.g. 'Q3 2026'.",
        },
        focusArea: {
          type: "string",
          description:
            "Optional: what to focus the risk analysis on (e.g. 'our hiring plans', 'the new product launch'). If omitted, produces a general risk overview.",
        },
      },
    },
  },

  // ── SALES AGENT / CRM — READ-ONLY TOOLS (auto-execute inline) ──────

  {
    name: "get_sales_pipeline_summary",
    description:
      "Get an aggregate summary of the sales pipeline: lead counts by status, deal counts and total value by stage, won/lost counts, and conversion rate. Use this for any question about overall sales performance, pipeline health, or dashboard-style numbers.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_pipeline_stages",
    description: "List this organization's sales pipeline stages in order.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_crm_companies",
    description: "List customer/prospect companies (CRM accounts) for this organization.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results. Defaults to 20." },
      },
    },
  },
  {
    name: "list_contacts",
    description: "List contacts, optionally filtered by which CRM company or lead they belong to.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        crmCompanyId: { type: "string", description: "Optional: only contacts at this company." },
        leadId: { type: "string", description: "Optional: only contacts tied to this lead." },
        limit: { type: "number", description: "Max results. Defaults to 20." },
      },
    },
  },
  {
    name: "list_leads",
    description: "List leads, optionally filtered by status.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Optional filter: NEW, CONTACTED, QUALIFIED, UNQUALIFIED, CONVERTED, or LOST.",
        },
        limit: { type: "number", description: "Max results. Defaults to 20." },
      },
    },
  },
  {
    name: "get_lead",
    description: "Get full details of a specific lead, including its contacts, deals, tasks, follow-ups, and communication history.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "ID of the lead." },
      },
      required: ["leadId"],
    },
  },
  {
    name: "list_deals",
    description: "List deals, optionally filtered by pipeline stage name or status.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        stageName: { type: "string", description: "Optional: filter by stage name, e.g. 'Negotiation'." },
        status: { type: "string", description: "Optional filter: OPEN, WON, or LOST." },
        limit: { type: "number", description: "Max results. Defaults to 20." },
      },
    },
  },
  {
    name: "get_deal",
    description: "Get full details of a specific deal, including its tasks, follow-ups, communication history, and sales documents (quotations/proposals).",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "ID of the deal." },
      },
      required: ["dealId"],
    },
  },
  {
    name: "list_sales_tasks",
    description: "List sales tasks, optionally filtered by status.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional filter: TODO, IN_PROGRESS, DONE, or CANCELLED." },
        limit: { type: "number", description: "Max results. Defaults to 20." },
      },
    },
  },
  {
    name: "list_follow_ups",
    description: "List follow-ups. By default shows only incomplete ones, ordered by due date — useful for 'follow-ups due' questions.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        includeCompleted: { type: "boolean", description: "Include completed follow-ups too. Defaults to false." },
        limit: { type: "number", description: "Max results. Defaults to 20." },
      },
    },
  },
  {
    name: "list_communication_logs",
    description: "List logged communications (emails, calls, meetings, notes, texts) for a specific lead, deal, or contact.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        dealId: { type: "string" },
        contactId: { type: "string" },
        limit: { type: "number", description: "Max results. Defaults to 20." },
      },
    },
  },

  // ── SALES AGENT / CRM — MUTATING TOOLS (require confirmation) ──────

  {
    name: "create_crm_company",
    description: "Add a new customer/prospect company (CRM account) to the sales system.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        email: { type: "string", description: "General/main contact email for the company." },
        phone: { type: "string" },
        size: { type: "string", description: "Company size, e.g. '1-10', '50-200 employees'." },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_crm_company",
    description: "Update an existing CRM company's details (industry, website, email, phone, size, or notes). Use this instead of creating a new company when correcting or filling in missing info.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        crmCompanyId: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        size: { type: "string" },
        notes: { type: "string" },
      },
      required: ["crmCompanyId"],
    },
  },
  {
    name: "create_contact",
    description: "Add a new contact person, optionally linked to a CRM company and/or a lead.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        jobTitle: { type: "string" },
        crmCompanyId: { type: "string" },
        leadId: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_lead",
    description: "Create a new sales lead.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Lead's name (person or company)." },
        email: { type: "string" },
        phone: { type: "string" },
        jobTitle: { type: "string" },
        source: { type: "string", description: "Where the lead came from, e.g. 'website', 'referral', 'cold outreach'." },
        crmCompanyId: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_lead",
    description: "Update a lead's status, score, assignment, or notes.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        status: { type: "string", description: "NEW, CONTACTED, QUALIFIED, UNQUALIFIED, CONVERTED, or LOST." },
        score: { type: "number", description: "0-100 lead score." },
        aiConfidenceScore: { type: "number", description: "0-100 AI confidence in this score/assessment." },
        notes: { type: "string" },
      },
      required: ["leadId"],
    },
  },
  {
    name: "convert_lead_to_deal",
    description: "Convert a qualified lead into a new deal in the pipeline (starts at the first non-won/lost stage unless specified). Marks the lead CONVERTED and links it to the new deal.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        dealTitle: { type: "string" },
        value: { type: "number", description: "Estimated deal value." },
        currency: { type: "string", description: "Defaults to 'USD'." },
        expectedCloseDate: { type: "string", description: "ISO date." },
      },
      required: ["leadId", "dealTitle"],
    },
  },
  {
    name: "create_deal",
    description: "Create a new deal directly (not from a lead conversion).",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        value: { type: "number" },
        currency: { type: "string", description: "Defaults to 'USD'." },
        crmCompanyId: { type: "string" },
        contactId: { type: "string" },
        stageName: { type: "string", description: "Stage to start in. Defaults to the first pipeline stage." },
        expectedCloseDate: { type: "string", description: "ISO date." },
      },
      required: ["title"],
    },
  },
  {
    name: "update_deal",
    description: "Update a deal's stage, value, status, close date, or lost reason. Moving to a stage marked 'won' or 'lost' also sets status and actualCloseDate accordingly.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        stageName: { type: "string" },
        value: { type: "number" },
        expectedCloseDate: { type: "string", description: "ISO date." },
        lostReason: { type: "string", description: "Required when moving a deal to a 'lost' stage." },
        aiConfidenceScore: { type: "number", description: "0-100 AI confidence in this deal closing." },
      },
      required: ["dealId"],
    },
  },
  {
    name: "create_sales_task",
    description: "Create a sales task, optionally linked to a deal or lead.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        dueDate: { type: "string", description: "ISO date." },
        dealId: { type: "string" },
        leadId: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_sales_task_status",
    description: "Update a sales task's status.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", description: "TODO, IN_PROGRESS, DONE, or CANCELLED." },
      },
      required: ["taskId", "status"],
    },
  },
  {
    name: "create_follow_up",
    description: "Schedule a follow-up for a lead, deal, or contact.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        dueDate: { type: "string", description: "ISO date." },
        notes: { type: "string" },
        leadId: { type: "string" },
        dealId: { type: "string" },
        contactId: { type: "string" },
      },
      required: ["dueDate"],
    },
  },
  {
    name: "complete_follow_up",
    description: "Mark a follow-up as completed.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        followUpId: { type: "string" },
      },
      required: ["followUpId"],
    },
  },
  {
    name: "log_communication",
    description: "Log a past communication (email, call, meeting, note, or text) with a lead, deal, or contact. Use this to record customer history — including saving a note.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "EMAIL, CALL, MEETING, NOTE, or SMS." },
        content: { type: "string", description: "Summary or content of the communication." },
        direction: { type: "string", description: "Optional: INBOUND or OUTBOUND." },
        leadId: { type: "string" },
        dealId: { type: "string" },
        contactId: { type: "string" },
      },
      required: ["channel", "content"],
    },
  },
  {
    name: "delete_lead",
    description: "Permanently delete a lead. Use for duplicates or leads created by mistake. This cannot be undone.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string" },
      },
      required: ["leadId"],
    },
  },
];

export const READ_ONLY_TOOL_NAMES: string[] = ASSISTANT_TOOLS.filter(
  (t) => !t.mutating
).map((t) => t.name);

export const MUTATING_TOOL_NAMES: string[] = ASSISTANT_TOOLS.filter(
  (t) => t.mutating
).map((t) => t.name);

export const ALL_TOOL_DEFINITIONS = ASSISTANT_TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));
