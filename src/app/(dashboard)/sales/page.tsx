import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatCurrency(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency}`;
  }
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    NEW: "bg-blue-100 text-blue-800",
    CONTACTED: "bg-indigo-100 text-indigo-800",
    QUALIFIED: "bg-green-100 text-green-800",
    UNQUALIFIED: "bg-gray-100 text-gray-600",
    CONVERTED: "bg-purple-100 text-purple-800",
    LOST: "bg-red-100 text-red-800",
    OPEN: "bg-blue-100 text-blue-800",
    WON: "bg-green-100 text-green-800",
    TODO: "bg-gray-100 text-gray-600",
    IN_PROGRESS: "bg-blue-100 text-blue-800",
    DONE: "bg-green-100 text-green-800",
    CANCELLED: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

function DataNotConnected({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
      {label}: data not connected
    </div>
  );
}

export default async function SalesDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) redirect("/onboarding");

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    salesAgent,
    leadsByStatus,
    allDeals,
    followUpsDue,
    forecastDeals,
    pipelineStages,
    recentActionLogs,
    recentLeads,
    recentDeals,
  ] = await Promise.all([
    prisma.agent.findFirst({ where: { organizationId, type: "SALES" } }),
    prisma.lead.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    prisma.deal.findMany({
      where: { organizationId },
      select: { id: true, value: true, currency: true, status: true, pipelineStageId: true },
    }),
    prisma.followUp.count({ where: { organizationId, completed: false, dueDate: { lte: now } } }),
    prisma.deal.findMany({
      where: { organizationId, status: "OPEN", expectedCloseDate: { gte: now, lte: in30Days } },
      select: { value: true, currency: true },
    }),
    prisma.pipelineStage.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.agentActionLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { agent: { select: { type: true, name: true } } },
    }),
    prisma.lead.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.deal.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { pipelineStage: true },
    }),
  ]);

  const totalLeads = leadsByStatus.reduce((sum, g) => sum + g._count, 0);
  const newLeads = leadsByStatus.find((g) => g.status === "NEW")?._count ?? 0;
  const qualifiedLeads = leadsByStatus.find((g) => g.status === "QUALIFIED")?._count ?? 0;

  const openDeals = allDeals.filter((d) => d.status === "OPEN");
  const wonDeals = allDeals.filter((d) => d.status === "WON");
  const lostDeals = allDeals.filter((d) => d.status === "LOST");
  const currency = allDeals[0]?.currency ?? "USD";

  const pipelineValue = openDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
  const revenueGenerated = wonDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
  const forecastValue = forecastDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);

  const closedCount = wonDeals.length + lostDeals.length;
  const conversionRate = closedCount > 0 ? Math.round((wonDeals.length / closedCount) * 100) : null;

  const dealsByStage = pipelineStages.map((stage) => ({
    stage,
    count: allDeals.filter((d) => d.pipelineStageId === stage.id && d.status === "OPEN").length,
    value: allDeals
      .filter((d) => d.pipelineStageId === stage.id && d.status === "OPEN")
      .reduce((sum, d) => sum + Number(d.value ?? 0), 0),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Sales Dashboard</h1>
        <p className="text-sm text-gray-500">
          {salesAgent ? `${salesAgent.name} — pipeline overview` : "Sales Agent overview"}
        </p>
        <div className="mt-2 flex gap-4 text-sm">
          <Link href="/assistant" className="font-medium text-blue-600 hover:underline">
            Open CEO Assistant →
          </Link>
          <Link href="/executive" className="font-medium text-blue-600 hover:underline">
            Executive Dashboard →
          </Link>
        </div>
      </div>

      {/* Core metrics */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard label="Total Leads" value={String(totalLeads)} />
        <MetricCard label="New Leads" value={String(newLeads)} />
        <MetricCard label="Qualified Leads" value={String(qualifiedLeads)} />
        <MetricCard label="Active Deals" value={String(openDeals.length)} />
        <MetricCard label="Won Deals" value={String(wonDeals.length)} />
        <MetricCard label="Lost Deals" value={String(lostDeals.length)} />
        <MetricCard
          label="Conversion Rate"
          value={conversionRate === null ? "—" : `${conversionRate}%`}
          sub={conversionRate === null ? "No closed deals yet" : undefined}
        />
        <MetricCard label="Follow-ups Due" value={String(followUpsDue)} />
        <MetricCard label="Pipeline Value" value={formatCurrency(pipelineValue, currency)} />
        <MetricCard label="Revenue Generated" value={formatCurrency(revenueGenerated, currency)} />
        <MetricCard
          label="Sales Forecast"
          value={formatCurrency(forecastValue, currency)}
          sub="Open deals expected to close in the next 30 days"
        />
      </section>

      {/* Pipeline by stage */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Pipeline by Stage</h2>
        {dealsByStage.length > 0 ? (
          <div className="space-y-2">
            {dealsByStage.map(({ stage, count, value }) => (
              <div key={stage.id} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{stage.name}</span>
                  {stage.isWon && <StatusBadge status="WON" />}
                  {stage.isLost && <StatusBadge status="LOST" />}
                </div>
                <div className="text-gray-500">
                  {count} deal{count === 1 ? "" : "s"} · {formatCurrency(value, currency)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DataNotConnected label="Pipeline stages" />
        )}
      </section>

      {/* Recent leads */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Recent Leads</h2>
        {recentLeads.length > 0 ? (
          <div className="space-y-2">
            {recentLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                <span className="text-gray-900">{lead.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">score {lead.score}</span>
                  <StatusBadge status={lead.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DataNotConnected label="Leads" />
        )}
      </section>

      {/* Recent deals */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Recent Deals</h2>
        {recentDeals.length > 0 ? (
          <div className="space-y-2">
            {recentDeals.map((deal) => (
              <div key={deal.id} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                <div>
                  <div className="text-gray-900">{deal.title}</div>
                  <div className="text-xs text-gray-400">{deal.pipelineStage?.name ?? "No stage"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">{formatCurrency(Number(deal.value ?? 0), deal.currency)}</span>
                  <StatusBadge status={deal.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DataNotConnected label="Deals" />
        )}
      </section>

      {/* Recent activity — real audit trail, not a fabricated feed */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Recent Activity</h2>
        {recentActionLogs.length > 0 ? (
          <ul className="space-y-2">
            {recentActionLogs.map((log) => (
              <li key={log.id} className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2 text-sm">
                <div>
                  <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                    {log.agent?.type ?? "AGENT"}
                  </span>
                  {log.action.replace(/_/g, " ")}
                  {log.approvalStatus && (
                    <span className="ml-2 text-xs text-gray-400">({log.approvalStatus})</span>
                  )}
                </div>
                <div className="shrink-0 text-xs text-gray-400">{log.createdAt.toLocaleString()}</div>
              </li>
            ))}
          </ul>
        ) : (
          <DataNotConnected label="Activity log" />
        )}
      </section>
    </div>
  );
}
