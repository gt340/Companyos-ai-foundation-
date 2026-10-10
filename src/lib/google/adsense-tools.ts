// src/lib/google/adsense-tools.ts
// Read-only Google AdSense tools (AdSense Management API v2): earnings and
// performance reports, payments, and sites. The API cannot change anything.
//
// Requirements:
//  - The AdSense Management API enabled in the Google Cloud project.
//  - The connected Google account must have an AdSense account and must have
//    granted the adsense.readonly scope (requested by /api/auth/google/connect;
//    accounts connected before that scope was added must reconnect).
//
// Registered through src/lib/integrations/registry.ts. The AssistantTool
// import is type-only, so there is no circular import with tools.ts.
//
// Note: YouTube channel revenue is NOT in the AdSense API; it comes from the
// YouTube Analytics API (monetary scope) and is not covered here.

import type { AssistantTool } from "../assistant/tools";
import { prisma } from "@/lib/prisma";
import { getValidGoogleAccessToken } from "./token";

interface MinimalCtx {
  userId: string;
}

// Loosely-typed Google API JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ADSENSE_API = "https://adsense.googleapis.com/v2";
const SCOPE_ADSENSE = "https://www.googleapis.com/auth/adsense.readonly";

const NOT_CONNECTED =
  "No Google account is connected yet. Connect one at /integrations before using AdSense.";

async function requireAdSenseToken(userId: string): Promise<string> {
  const connection = await prisma.googleConnection.findUnique({
    where: { userId },
    select: { scopes: true },
  });
  if (!connection) throw new Error(NOT_CONNECTED);

  if (!connection.scopes.includes(SCOPE_ADSENSE)) {
    throw new Error(
      "Your connected Google account has not granted AdSense permission yet. Disconnect and reconnect your Google account at /integrations, and approve the AdSense permission on the Google screen."
    );
  }

  const token = await getValidGoogleAccessToken(userId);
  if (!token) throw new Error(NOT_CONNECTED);
  return token;
}

async function adsenseError(res: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const data = await res.json();
    message = data?.error?.message ?? fallback;
  } catch {
    // response body was not JSON - keep the fallback message
  }
  if (
    res.status === 403 &&
    /has not been used|is disabled|accessNotConfigured/i.test(message)
  ) {
    message +=
      " (Enable the AdSense Management API in the Google Cloud project: APIs & Services, Library.)";
  }
  return new Error(message);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

// Finds the user's (first) AdSense account, e.g. "accounts/pub-1234567890".
async function getAdSenseAccount(
  token: string
): Promise<{ name: string; displayName: string | null; timeZone: string | null } | null> {
  const res = await fetch(`${ADSENSE_API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await adsenseError(res, "Failed to load the AdSense account.");
  const data: Json = await res.json();
  const account: Json = data.accounts?.[0];
  if (!account) return null;
  return {
    name: account.name,
    displayName: account.displayName ?? null,
    timeZone: account.timeZone?.id ?? null,
  };
}

const NO_ACCOUNT_NOTE =
  "No AdSense account is linked to the connected Google account. AdSense must be set up and approved for this Google account first.";

function dateParts(prefix: string, iso: string): [string, string][] {
  const [y, m, d] = iso.split("-");
  return [
    [`${prefix}.year`, String(Number(y))],
    [`${prefix}.month`, String(Number(m))],
    [`${prefix}.day`, String(Number(d))],
  ];
}

// -- REPORT ---------------------------------------------------------------

const ALLOWED_RANGES = new Set([
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "MONTH_TO_DATE",
  "YEAR_TO_DATE",
]);

const ALLOWED_METRICS = new Set([
  "PAGE_VIEWS",
  "IMPRESSIONS",
  "CLICKS",
  "ESTIMATED_EARNINGS",
  "PAGE_VIEWS_RPM",
  "IMPRESSIONS_RPM",
  "COST_PER_CLICK",
  "PAGE_VIEWS_CTR",
  "IMPRESSIONS_CTR",
]);

const ALLOWED_DIMENSIONS = new Set([
  "DATE",
  "WEEK",
  "MONTH",
  "COUNTRY_NAME",
  "DOMAIN_NAME",
  "AD_UNIT_NAME",
  "PLATFORM_TYPE_NAME",
  "AD_FORMAT_NAME",
]);

const DEFAULT_METRICS = ["ESTIMATED_EARNINGS", "PAGE_VIEWS", "IMPRESSIONS", "CLICKS"];

function parseUpperList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function getAdSenseReport(
  args: {
    dateRange?: string;
    startDate?: string;
    endDate?: string;
    metrics?: string;
    dimensions?: string;
    maxResults?: number;
  },
  ctx: MinimalCtx
) {
  const token = await requireAdSenseToken(ctx.userId);
  const account = await getAdSenseAccount(token);
  if (!account) return { found: false, note: NO_ACCOUNT_NOTE };

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const params = new URLSearchParams();

  if (args.startDate || args.endDate) {
    if (!args.startDate || !args.endDate) {
      throw new Error("Provide both startDate and endDate (YYYY-MM-DD) for a custom range.");
    }
    if (!dateRe.test(args.startDate) || !dateRe.test(args.endDate)) {
      throw new Error("startDate and endDate must be in YYYY-MM-DD format.");
    }
    params.set("dateRange", "CUSTOM");
    for (const [k, v] of dateParts("startDate", args.startDate)) params.set(k, v);
    for (const [k, v] of dateParts("endDate", args.endDate)) params.set(k, v);
  } else {
    const range = (args.dateRange ?? "LAST_30_DAYS").toUpperCase();
    if (!ALLOWED_RANGES.has(range)) {
      throw new Error(
        `Unsupported dateRange "${args.dateRange}". Allowed: ${[...ALLOWED_RANGES].join(", ")}, or give startDate and endDate.`
      );
    }
    params.set("dateRange", range);
  }

  const metrics = parseUpperList(args.metrics);
  const metricList = metrics.length > 0 ? metrics : DEFAULT_METRICS;
  for (const m of metricList) {
    if (!ALLOWED_METRICS.has(m)) {
      throw new Error(`Unsupported metric "${m}". Allowed: ${[...ALLOWED_METRICS].join(", ")}.`);
    }
    params.append("metrics", m);
  }

  const dimensionList = parseUpperList(args.dimensions);
  for (const d of dimensionList) {
    if (!ALLOWED_DIMENSIONS.has(d)) {
      throw new Error(`Unsupported dimension "${d}". Allowed: ${[...ALLOWED_DIMENSIONS].join(", ")}.`);
    }
    params.append("dimensions", d);
  }
  if (dimensionList.length > 0) {
    params.set("limit", String(clampInt(args.maxResults, 25, 1, 100)));
  }

  const res = await fetch(`${ADSENSE_API}/${account.name}/reports:generate?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await adsenseError(res, "Failed to load the AdSense report.");
  const data: Json = await res.json();

  const headers: Json[] = data.headers ?? [];
  const names: string[] = headers.map((h: Json) => h.name);
  const currency: string | null =
    headers.find((h: Json) => h.currencyCode)?.currencyCode ?? null;

  const toObject = (cells: Json[] | undefined): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    names.forEach((name, i) => {
      obj[name] = cells?.[i]?.value ?? null;
    });
    return obj;
  };

  const rows = (data.rows ?? []).map((r: Json) => toObject(r.cells));
  const totals = data.totals ? toObject(data.totals.cells) : null;

  return {
    found: true,
    account: account.displayName ?? account.name,
    currency,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    totals,
    ...(dimensionList.length > 0 ? { rowCount: rows.length, rows } : {}),
    note: "Earnings are estimates until finalized by AdSense at month end. Amounts are in the account's currency.",
  };
}

// -- PAYMENTS -------------------------------------------------------------

async function listAdSensePayments(_args: unknown, ctx: MinimalCtx) {
  const token = await requireAdSenseToken(ctx.userId);
  const account = await getAdSenseAccount(token);
  if (!account) return { found: false, note: NO_ACCOUNT_NOTE };

  const res = await fetch(`${ADSENSE_API}/${account.name}/payments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await adsenseError(res, "Failed to load AdSense payments.");
  const data: Json = await res.json();

  const payments = (data.payments ?? []).map((p: Json) => ({
    date: p.date
      ? `${p.date.year}-${String(p.date.month).padStart(2, "0")}-${String(p.date.day ?? 1).padStart(2, "0")}`
      : null,
    amount: p.amount ?? null,
  }));

  return {
    found: true,
    account: account.displayName ?? account.name,
    payments,
    count: payments.length,
    ...(payments.length === 0 ? { note: "No payments or upcoming payment estimates yet." } : {}),
  };
}

// -- SITES ----------------------------------------------------------------

async function listAdSenseSites(_args: unknown, ctx: MinimalCtx) {
  const token = await requireAdSenseToken(ctx.userId);
  const account = await getAdSenseAccount(token);
  if (!account) return { found: false, note: NO_ACCOUNT_NOTE };

  const res = await fetch(`${ADSENSE_API}/${account.name}/sites?pageSize=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await adsenseError(res, "Failed to load AdSense sites.");
  const data: Json = await res.json();

  const sites = (data.sites ?? []).map((s: Json) => ({
    domain: s.domain ?? null,
    state: s.state ?? null,
    autoAdsEnabled: s.autoAdsEnabled ?? null,
  }));

  return {
    found: true,
    account: account.displayName ?? account.name,
    sites,
    count: sites.length,
    ...(sites.length === 0 ? { note: "No sites are added to this AdSense account yet." } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdSenseExecutorFn = (args: any, ctx: MinimalCtx) => Promise<unknown>;

export const ADSENSE_TOOL_EXECUTORS: Record<string, AdSenseExecutorFn> = {
  get_adsense_report: getAdSenseReport,
  list_adsense_payments: listAdSensePayments,
  list_adsense_sites: listAdSenseSites,
};

// All AdSense tools are read-only, so they run immediately with no Confirm card.
export const ADSENSE_TOOL_DEFINITIONS: AssistantTool[] = [
  {
    name: "get_adsense_report",
    description:
      "Get real Google AdSense earnings and performance for the user's AdSense account: estimated earnings, page views, impressions, clicks, RPM, cost per click, and CTR. With no dimensions it returns totals; set dimensions to break down by DATE, WEEK, MONTH, COUNTRY_NAME, DOMAIN_NAME, AD_UNIT_NAME, PLATFORM_TYPE_NAME, or AD_FORMAT_NAME. Defaults to the last 30 days. Call this immediately whenever the user asks about ad earnings or AdSense - do not tell them to connect first; only report that if this tool itself returns a not-connected error. Never state AdSense numbers without calling this tool. Earnings are estimates until AdSense finalizes them. This is read-only; AdSense cannot be changed through the assistant. YouTube channel revenue is not included here.",
    mutating: false,
    parameters: {
      type: "object",
      properties: {
        dateRange: {
          type: "string",
          description:
            "TODAY, YESTERDAY, LAST_7_DAYS, LAST_30_DAYS (default), MONTH_TO_DATE, or YEAR_TO_DATE. Ignored if startDate and endDate are given.",
        },
        startDate: { type: "string", description: "Custom range start, YYYY-MM-DD (use with endDate)." },
        endDate: { type: "string", description: "Custom range end, YYYY-MM-DD (use with startDate)." },
        metrics: {
          type: "string",
          description:
            "Optional comma-separated metrics from: ESTIMATED_EARNINGS, PAGE_VIEWS, IMPRESSIONS, CLICKS, PAGE_VIEWS_RPM, IMPRESSIONS_RPM, COST_PER_CLICK, PAGE_VIEWS_CTR, IMPRESSIONS_CTR. Defaults to earnings, page views, impressions, and clicks.",
        },
        dimensions: {
          type: "string",
          description:
            "Optional comma-separated breakdown from: DATE, WEEK, MONTH, COUNTRY_NAME, DOMAIN_NAME, AD_UNIT_NAME, PLATFORM_TYPE_NAME, AD_FORMAT_NAME.",
        },
        maxResults: { type: "number", description: "Max rows when using dimensions (1-100). Defaults to 25." },
      },
    },
  },
  {
    name: "list_adsense_payments",
    description:
      "List the user's AdSense payments and the upcoming payment estimate (date and amount). Call this immediately when the user asks about AdSense payments. Read-only.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_adsense_sites",
    description:
      "List the sites added to the user's AdSense account with their approval state and whether auto ads are on. Read-only.",
    mutating: false,
    parameters: { type: "object", properties: {} },
  },
];
