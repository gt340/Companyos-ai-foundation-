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
