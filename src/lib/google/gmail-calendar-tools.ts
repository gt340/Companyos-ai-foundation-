// src/lib/google/gmail-calendar-tools.ts
// Real Gmail + Calendar tool executors, built on getValidGoogleAccessToken.
// Kept in their own file (rather than growing tool-executors.ts further)
// so this stays easy to extend independently. Each function only needs
// the calling user's id, not the full assistant ExecutorContext, so a
// minimal context type is used here and structurally satisfies the
// dispatch table's broader ExecutorContext requirement without needing
// to import or couple to it.

import { getValidGoogleAccessToken } from "./token";
import { DRIVE_TOOL_EXECUTORS } from "./drive-tools";

interface MinimalCtx {
  userId: string;
}

async function requireGoogleToken(userId: string): Promise<string> {
  const token = await getValidGoogleAccessToken(userId);
  if (!token) {
    throw new Error(
      "No Google account is connected yet. Connect one at /integrations before using Gmail or Calendar."
    );
  }
  return token;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── GMAIL ────────────────────────────────────────────────────────────

async function listEmails(
  args: { query?: string; maxResults?: number },
  ctx: MinimalCtx
) {
  const token = await requireGoogleToken(ctx.userId);
  const maxResults = Math.min(args.maxResults ?? 10, 25);

  const listParams = new URLSearchParams({ maxResults: String(maxResults) });
  if (args.query) listParams.set("q", args.query);

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const listData = await listRes.json();

  if (!listRes.ok) {
    throw new Error(listData.error?.message ?? "Failed to list Gmail messages.");
  }

  const messageRefs: { id: string }[] = listData.messages ?? [];
  if (messageRefs.length === 0) {
    return { emails: [], note: "No messages found matching that query." };
  }

  // Fetch real headers + snippet for each message — Gmail's list endpoint
  // only returns bare IDs, nothing else.
  const emails = await Promise.all(
    messageRefs.map(async (ref) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const msg = await msgRes.json();
      if (!msgRes.ok) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const headers: any[] = msg.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value ?? null;

      return {
        id: msg.id,
        threadId: msg.threadId,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        date: getHeader("Date"),
        snippet: msg.snippet ?? null,
      };
    })
  );

  return { emails: emails.filter(Boolean), count: emails.filter(Boolean).length };
}

async function sendEmail(
  args: { to: string; subject: string; body: string; cc?: string },
  ctx: MinimalCtx
) {
  const token = await requireGoogleToken(ctx.userId);

  const lines = [
    `To: ${args.to}`,
    args.cc ? `Cc: ${args.cc}` : null,
    `Subject: ${args.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    args.body,
  ].filter((l): l is string => l !== null);

  const raw = encodeBase64Url(lines.join("\r\n"));

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Failed to send email via Gmail.");
  }

  return { sent: true, to: args.to, subject: args.subject, messageId: data.id };
}

// ── GOOGLE CALENDAR ──────────────────────────────────────────────────

async function listCalendarEvents(
  args: { timeMin?: string; timeMax?: string; maxResults?: number },
  ctx: MinimalCtx
) {
  const token = await requireGoogleToken(ctx.userId);
  const maxResults = Math.min(args.maxResults ?? 10, 25);

  const params = new URLSearchParams({
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: args.timeMin ?? new Date().toISOString(),
  });
  if (args.timeMax) params.set("timeMax", args.timeMax);

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Failed to list calendar events.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = (data.items ?? []).map((e: any) => ({
    id: e.id,
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    location: e.location ?? null,
    attendees: (e.attendees ?? []).map((a: { email: string }) => a.email),
    htmlLink: e.htmlLink,
  }));

  return { events, count: events.length };
}

async function createCalendarEvent(
  args: {
    summary: string;
    startDateTime: string;
    endDateTime: string;
    timeZone?: string;
    description?: string;
    location?: string;
    attendeeEmails?: string[];
  },
  ctx: MinimalCtx
) {
  const token = await requireGoogleToken(ctx.userId);

  const body = {
    summary: args.summary,
    description: args.description,
    location: args.location,
    start: { dateTime: args.startDateTime, timeZone: args.timeZone ?? "UTC" },
    end: { dateTime: args.endDateTime, timeZone: args.timeZone ?? "UTC" },
    attendees: (args.attendeeEmails ?? []).map((email) => ({ email })),
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Failed to create calendar event.");
  }

  return {
    id: data.id,
    summary: data.summary,
    start: data.start?.dateTime,
    end: data.end?.dateTime,
    htmlLink: data.htmlLink,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoogleExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const GOOGLE_TOOL_EXECUTORS: Record<string, GoogleExecutorFn> = {
  list_emails: listEmails,
  send_email: sendEmail,
  list_calendar_events: listCalendarEvents,
  create_calendar_event: createCalendarEvent,
  // Read-only Google Drive tools (see drive-tools.ts)
  ...DRIVE_TOOL_EXECUTORS,
};

// Mirrors TOOL_MIN_ROLES' shape from tool-executors.ts, merged in there.
// Gmail/Calendar are personal to the connected Google account, not
// org-sensitive the way inviting a member is — no role restriction here,
// any active member can use their own connected account. send_email and
// create_calendar_event are still mutating (real external actions), so
// they go through the existing Confirm-card flow regardless.
// The Drive tools are read-only, so none of them appear in this list.
export const GOOGLE_MUTATING_TOOL_NAMES = ["send_email", "create_calendar_event"];
