// src/lib/meetings/meeting-tools.ts
// Meeting tools for the assistant:
//   - Google Meet: creates a Google Calendar event with a Meet link and emails
//     the invitations. Uses the user's connected Google account (the calendar
//     scope was already granted), so no extra setup is needed.
//   - Zoom: creates, lists, and cancels Zoom meetings on the COMPANY's own Zoom
//     account. Each company connects its Zoom (owner/admin, at /integrations)
//     through Zoom's OAuth flow; see src/lib/zoom/zoom-connection.ts. One
//     company can never act on another company's Zoom.
//     Optional legacy fallback: if the server variables ZOOM_ACCOUNT_ID,
//     ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (a Zoom Server-to-Server app) AND
//     ZOOM_S2S_ORG_ID are all set, that one company (the one whose id equals
//     ZOOM_S2S_ORG_ID) may use the Server-to-Server account when it has not
//     connected its own Zoom. No other company ever uses it.
//
// Creating or cancelling a meeting is a real external action, so those tools
// are MUTATING and always show a Confirm card first.
//
// Registered through src/lib/integrations/registry.ts. The AssistantTool
// import is type-only, so there is no circular import with tools.ts.

import { randomUUID } from "crypto";
import type { AssistantTool } from "../assistant/tools";
import { getValidGoogleAccessToken } from "../google/token";
import { getActiveOrganizationId } from "@/lib/active-org";
import { ZOOM_API, getOrgZoomAccessToken } from "@/lib/zoom/zoom-connection";

interface MinimalCtx {
  userId: string;
}

// Loosely-typed external API JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

// -- GOOGLE MEET ---------------------------------------------------------

async function createGoogleMeet(
  args: {
    summary: string;
    startDateTime: string;
    endDateTime: string;
    timeZone?: string;
    description?: string;
    attendeeEmails?: string[];
  },
  ctx: MinimalCtx
) {
  const token = await getValidGoogleAccessToken(ctx.userId);
  if (!token) {
    throw new Error(
      "No Google account is connected yet. Connect one at /integrations before creating a Google Meet."
    );
  }

  const attendees = (Array.isArray(args.attendeeEmails) ? args.attendeeEmails : [])
    .map((e) => String(e).trim())
    .filter(Boolean);
  const timeZone = args.timeZone ?? "UTC";

  const body = {
    summary: args.summary,
    description: args.description,
    start: { dateTime: args.startDateTime, timeZone },
    end: { dateTime: args.endDateTime, timeZone },
    attendees: attendees.map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const params = new URLSearchParams({
    conferenceDataVersion: "1",
    sendUpdates: attendees.length > 0 ? "all" : "none",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const data: Json = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message ?? "Failed to create the Google Meet.");
  }

  const meetLink: string | null =
    data.hangoutLink ??
    data.conferenceData?.entryPoints?.find((e: Json) => e.entryPointType === "video")
      ?.uri ??
    null;

  return {
    created: true,
    eventId: data.id,
    summary: data.summary,
    start: data.start?.dateTime,
    end: data.end?.dateTime,
    timeZone,
    meetLink,
    invitedAttendees: attendees,
    calendarLink: data.htmlLink,
    ...(meetLink
      ? {}
      : {
          note: "The calendar event was created but the Meet link was not ready yet. Open the event in Google Calendar to see it.",
        }),
  };
}

// -- ZOOM ----------------------------------------------------------------

const ZOOM_NOT_CONNECTED =
  "Zoom is not connected for this company yet. A company owner or admin can connect it at /integrations.";

// Which company is this request for? Prefer the executor context if it
// carries the organization; otherwise use the user's active organization.
async function resolveOrganizationId(ctx: MinimalCtx): Promise<string | null> {
  const fromContext = (ctx as MinimalCtx & { organizationId?: string }).organizationId;
  if (fromContext) return fromContext;
  try {
    return await getActiveOrganizationId(ctx.userId);
  } catch {
    return null;
  }
}

// -- Legacy Server-to-Server fallback (one designated company only) -------

let cachedS2SToken: { value: string; expiresAt: number } | null = null;

function s2sConfigured(): boolean {
  return Boolean(
    process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET
  );
}

async function getServerToServerZoomToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID as string;
  const clientId = process.env.ZOOM_CLIENT_ID as string;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET as string;

  if (cachedS2SToken && cachedS2SToken.expiresAt > Date.now() + 60_000) {
    return cachedS2SToken.value;
  }

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  const data: Json = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Could not sign in to Zoom: ${data.reason ?? data.error ?? "unknown error"}. Check the Zoom credentials and that the Zoom app is activated.`
    );
  }

  cachedS2SToken = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  };
  return cachedS2SToken.value;
}

interface ZoomAuth {
  token: string;
  // "me" for a company's own OAuth connection; the configured user for the
  // legacy Server-to-Server fallback.
  userPath: string;
}

async function getZoomAuth(ctx: MinimalCtx): Promise<ZoomAuth> {
  const organizationId = await resolveOrganizationId(ctx);
  if (!organizationId) {
    throw new Error("Could not tell which company this Zoom request is for.");
  }

  const orgToken = await getOrgZoomAccessToken(organizationId);
  if (orgToken) return { token: orgToken, userPath: "me" };

  if (
    process.env.ZOOM_S2S_ORG_ID &&
    process.env.ZOOM_S2S_ORG_ID === organizationId &&
    s2sConfigured()
  ) {
    return {
      token: await getServerToServerZoomToken(),
      userPath: process.env.ZOOM_USER_ID ?? "me",
    };
  }

  throw new Error(ZOOM_NOT_CONNECTED);
}

async function zoomError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const data: Json = await res.json();
    message = data?.message ?? data?.reason ?? fallback;
  } catch {
    // response body was not JSON - keep the fallback message
  }
  if (res.status === 401 || res.status === 403) {
    message +=
      " (The Zoom connection may be missing permissions. A company owner or admin can reconnect Zoom at /integrations.)";
  }
  return new Error(message);
}

async function createZoomMeeting(
  args: {
    topic: string;
    startDateTime: string;
    durationMinutes?: number;
    timeZone?: string;
    agenda?: string;
  },
  ctx: MinimalCtx
) {
  const { token, userPath } = await getZoomAuth(ctx);

  const duration = Math.min(
    Math.max(Math.floor(Number(args.durationMinutes) || 30), 5),
    600
  );
  const timeZone = args.timeZone ?? "UTC";

  const res = await fetch(`${ZOOM_API}/users/${encodeURIComponent(userPath)}/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: args.topic,
      type: 2, // scheduled meeting
      start_time: args.startDateTime,
      duration,
      timezone: timeZone,
      agenda: args.agenda ?? "",
      settings: {
        waiting_room: true,
        join_before_host: false,
        mute_upon_entry: true,
        host_video: true,
        participant_video: true,
      },
    }),
  });
  if (!res.ok) throw await zoomError(res, "Failed to create the Zoom meeting.");
  const data: Json = await res.json();

  return {
    created: true,
    meetingId: String(data.id),
    topic: data.topic,
    startTime: data.start_time,
    timeZone: data.timezone ?? timeZone,
    durationMinutes: data.duration ?? duration,
    joinUrl: data.join_url,
    passcode: data.password ?? null,
    hostStartUrl: data.start_url ?? null,
    note: "Share joinUrl (and the passcode if needed) with attendees. hostStartUrl is only for the host; do not share it with attendees.",
  };
}

async function listZoomMeetings(args: { maxResults?: number }, ctx: MinimalCtx) {
  const { token, userPath } = await getZoomAuth(ctx);
  const pageSize = Math.min(Math.max(Math.floor(Number(args.maxResults) || 10), 1), 30);

  const params = new URLSearchParams({
    type: "upcoming",
    page_size: String(pageSize),
  });
  const res = await fetch(
    `${ZOOM_API}/users/${encodeURIComponent(userPath)}/meetings?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw await zoomError(res, "Failed to list Zoom meetings.");
  const data: Json = await res.json();

  const meetings = (data.meetings ?? []).map((m: Json) => ({
    meetingId: String(m.id),
    topic: m.topic,
    startTime: m.start_time ?? null,
    timeZone: m.timezone ?? null,
    durationMinutes: m.duration ?? null,
    joinUrl: m.join_url ?? null,
  }));

  if (meetings.length === 0) {
    return { meetings: [], count: 0, note: "No upcoming Zoom meetings." };
  }
  return { meetings, count: meetings.length };
}

async function deleteZoomMeeting(args: { meetingId: string }, ctx: MinimalCtx) {
  const meetingId = String(args.meetingId ?? "").trim();
  if (!/^\d{6,15}$/.test(meetingId)) {
    throw new Error("That is not a valid Zoom meeting ID (it should be a number).");
  }

  const { token } = await getZoomAuth(ctx);
  const res = await fetch(`${ZOOM_API}/meetings/${meetingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await zoomError(res, "Failed to cancel that Zoom meeting.");

  return { cancelled: true, meetingId };
}

// -- REGISTRATION --------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MeetingExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const MEETING_TOOL_EXECUTORS: Record<string, MeetingExecutorFn> = {
  create_google_meet: createGoogleMeet,
  create_zoom_meeting: createZoomMeeting,
  list_zoom_meetings: listZoomMeetings,
  delete_zoom_meeting: deleteZoomMeeting,
};

// Real external actions: these always go through the Confirm card.
export const MEETING_MUTATING_TOOL_NAMES = [
  "create_google_meet",
  "create_zoom_meeting",
  "delete_zoom_meeting",
];

export const MEETING_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "create_google_meet",
    description:
      "Schedule a Google Meet video meeting: creates an event on the user's Google Calendar with a Meet link and emails invitations to the attendees. This is a real external action and always requires explicit confirmation before it happens. Agree the topic, date, time, length, and attendee emails with the user first. If you do not know the user's time zone, ask for it instead of assuming UTC. You cannot join or speak in the meeting yourself; this only schedules it and invites people.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Meeting title." },
        startDateTime: {
          type: "string",
          description: "Start as ISO datetime in the given time zone, e.g. '2026-10-15T14:00:00'.",
        },
        endDateTime: { type: "string", description: "End as ISO datetime, same format." },
        timeZone: {
          type: "string",
          description: "IANA time zone, e.g. 'Africa/Accra' or 'America/New_York'. Defaults to UTC.",
        },
        description: { type: "string", description: "Optional agenda or notes." },
        attendeeEmails: {
          type: "array",
          items: { type: "string" },
          description: "Email addresses to invite. They each receive a calendar invitation with the Meet link.",
        },
      },
      required: ["summary", "startDateTime", "endDateTime"],
    },
  },
  {
    name: "create_zoom_meeting",
    description:
      "Schedule a Zoom meeting on the company's own Zoom account and get the join link. This is a real external action and always requires explicit confirmation before it happens. Agree the topic, date, time, and length with the user first, and ask for their time zone if you do not know it. This does not email anyone: after it is created, offer to send the joinUrl to attendees with send_email. If the company has not connected Zoom, the tool says so and a company owner or admin must connect it at /integrations. You cannot join or speak in the meeting yourself.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Meeting topic/title." },
        startDateTime: {
          type: "string",
          description: "Start as ISO datetime in the given time zone, e.g. '2026-10-15T14:00:00'.",
        },
        durationMinutes: { type: "number", description: "Length in minutes (5-600). Defaults to 30." },
        timeZone: {
          type: "string",
          description: "IANA time zone, e.g. 'Africa/Accra'. Defaults to UTC.",
        },
        agenda: { type: "string", description: "Optional agenda text." },
      },
      required: ["topic", "startDateTime"],
    },
  },
  {
    name: "list_zoom_meetings",
    description:
      "List the company's upcoming scheduled Zoom meetings (topic, start time, join link, meeting ID). Call this immediately when the user asks about their Zoom meetings; only report that Zoom is not connected if this tool itself says so. Read-only.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        maxResults: { type: "number", description: "Max meetings (1-30). Defaults to 10." },
      },
    },
  },
  {
    name: "delete_zoom_meeting",
    description:
      "Cancel (delete) a scheduled Zoom meeting by its meeting ID (get IDs from list_zoom_meetings). This cannot be undone and always requires explicit confirmation before it happens.",
    mutating: true,
    parameters: {
      type: "object",
      properties: {
        meetingId: { type: "string", description: "The Zoom meeting ID (a number)." },
      },
      required: ["meetingId"],
    },
  },
];
