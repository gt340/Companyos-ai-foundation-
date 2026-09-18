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
      "Semantic search over the organization's uploaded knowledge base documents (PDFs, Word, Excel, PowerPoint, images, audio/video transcripts, website URLs). Use this whenever the user asks a question that might be answered by company documents.",
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
      "List previously generated executive reports for this organization, most recent first.",
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
      "Get the full content of a specific executive report, including all its sections.",
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
      "Save something important to the CEO Agent's persistent memory so it can be recalled in future conversations and used in executive reports. Use for company facts, strategic goals, founder preferences, decisions, business events, or insights the founder wants remembered long-term. Does not change core company data, so it runs immediately without requiring confirmation.",
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
      "Create a knowledge base document from a website URL (not for file uploads — those go through the upload UI). Use when the user asks the assistant to ingest a specific URL.",
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
      "Generate a structured executive report using only the company's actual profile, knowledge base, and CEO memory — never fabricates data. Sections for unavailable data sources (financials, sales, marketing, etc.) will say so explicitly rather than inventing numbers. The report is saved permanently and appears in the Executive Dashboard.",
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
      },
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
