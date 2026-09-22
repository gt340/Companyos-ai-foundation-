import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PLANNING: "bg-gray-100 text-gray-600",
    ACTIVE: "bg-green-100 text-green-800",
    PAUSED: "bg-yellow-100 text-yellow-800",
    COMPLETED: "bg-blue-100 text-blue-800",
    CANCELLED: "bg-red-100 text-red-800",
    DRAFT: "bg-gray-100 text-gray-600",
    SCHEDULED: "bg-blue-100 text-blue-800",
    PUBLISHED: "bg-green-100 text-green-800",
    ARCHIVED: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
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

function DataNotConnected({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
      {label}: data not connected
    </div>
  );
}

export default async function MarketingDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const organizationId = await getActiveOrganizationId(user.id);
  if (!organizationId) redirect("/onboarding");

  const now = new Date();

  const [
    marketingAgent,
    campaigns,
    upcomingContent,
    socialContent,
    emailContent,
    competitors,
    latestReport,
    pastReports,
  ] = await Promise.all([
    prisma.agent.findFirst({ where: { organizationId, type: "MARKETING" } }),
    prisma.campaign.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    prisma.contentItem.findMany({
      where: { organizationId, scheduledFor: { gte: now } },
      orderBy: { scheduledFor: "asc" },
      take: 10,
      include: { campaign: { select: { name: true } } },
    }),
    prisma.contentItem.findMany({
      where: { organizationId, type: { in: ["SOCIAL_POST", "CAPTION"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.contentItem.findMany({
      where: { organizationId, type: "EMAIL_CAMPAIGN" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.competitor.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.executiveReport.findFirst({
      where: { organizationId, agent: { type: "MARKETING" } },
      orderBy: { createdAt: "desc" },
      include: { sections: { orderBy: { order: "asc" } } },
    }),
    prisma.executiveReport.findMany({
      where: { organizationId, agent: { type: "MARKETING" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, status: true, createdAt: true },
    }),
  ]);

  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE");
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);
  const totalCost = campaigns.reduce((sum, c) => sum + (c.costToDate ? Number(c.costToDate) : 0), 0);
  const totalRevenue = campaigns.reduce((sum, c) => sum + (c.revenue ? Number(c.revenue) : 0), 0);
  const hasCostData = campaigns.some((c) => c.costToDate !== null);
  const hasRevenueData = campaigns.some((c) => c.revenue !== null);
  const overallRoi = hasCostData && hasRevenueData && totalCost > 0
    ? Math.round(((totalRevenue - totalCost) / totalCost) * 100)
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Marketing Dashboard</h1>
        <p className="text-sm text-gray-500">
          {marketingAgent ? `${marketingAgent.name} — marketing overview` : "Marketing overview"}
        </p>
        <div className="mt-2 flex gap-4 text-sm">
          <Link href="/assistant" className="font-medium text-blue-600 hover:underline">
            Open CEO Assistant →
          </Link>
          <Link href="/executive" className="font-medium text-blue-600 hover:underline">
            Executive Dashboard →
          </Link>
          <Link href="/sales" className="font-medium text-blue-600 hover:underline">
            Sales Dashboard →
          </Link>
        </div>
      </div>

      {/* Marketing Overview */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard label="Total Campaigns" value={String(campaigns.length)} />
        <MetricCard label="Active Campaigns" value={String(activeCampaigns.length)} />
        <MetricCard label="Impressions" value={totalImpressions.toLocaleString()} />
        <MetricCard label="Clicks" value={totalClicks.toLocaleString()} />
        <MetricCard label="Conversions" value={totalConversions.toLocaleString()} />
        <MetricCard
          label="Overall ROI"
          value={overallRoi === null ? "—" : `${overallRoi}%`}
          sub={overallRoi === null ? "Cost and/or revenue not recorded" : undefined}
        />
        <MetricCard label="Competitors Tracked" value={String(competitors.length)} />
        <MetricCard label="Content Scheduled" value={String(upcomingContent.length)} />
      </section>

      {/* Campaigns */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Campaigns</h2>
        {campaigns.length > 0 ? (
          <div className="space-y-2">
            {campaigns.slice(0, 8).map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                <div>
                  <div className="text-gray-900">{c.name}</div>
                  <div className="text-xs text-gray-400">{c.channel}</div>
                </div>
                <div className="flex items-center gap-2">
                  {c.budget !== null && <span className="text-xs text-gray-500">budget {Number(c.budget).toLocaleString()}</span>}
                  <StatusBadge status={c.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DataNotConnected label="Campaigns" />
        )}
      </section>

      {/* Content Calendar */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Content Calendar</h2>
        {upcomingContent.length > 0 ? (
          <div className="space-y-2">
            {upcomingContent.map((item) => (
              <div key={item.id} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                <div>
                  <div className="text-gray-900">{item.title}</div>
                  <div className="text-xs text-gray-400">
                    {item.type.replace(/_/g, " ")}{item.platform ? ` · ${item.platform}` : ""}{item.campaign ? ` · ${item.campaign.name}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{item.scheduledFor?.toLocaleDateString()}</span>
                  <StatusBadge status={item.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DataNotConnected label="Scheduled content" />
        )}
      </section>

      {/* Social Media */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Social Media</h2>
        {socialContent.length > 0 ? (
          <div className="space-y-2">
            {socialContent.map((item) => (
              <div key={item.id} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                <div>
                  <div className="text-gray-900">{item.title}</div>
                  <div className="text-xs text-gray-400">{item.platform ?? "Platform not set"}</div>
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        ) : (
          <DataNotConnected label="Social posts" />
        )}
      </section>

      {/* SEO — deliberately not fabricated, no connected data source */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">SEO</h2>
        <DataNotConnected label="SEO tracking" />
      </section>

      {/* Email Marketing */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Email Marketing</h2>
        {emailContent.length > 0 ? (
          <div className="space-y-2">
            {emailContent.map((item) => (
              <div key={item.id} className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
                <span className="text-gray-900">{item.title}</span>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        ) : (
          <DataNotConnected label="Email campaigns" />
        )}
      </section>

      {/* Competitors */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Competitors</h2>
        {competitors.length > 0 ? (
          <div className="space-y-2">
            {competitors.map((c) => (
              <div key={c.id} className="border-b border-gray-100 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-900">{c.name}</span>
                  <span className="text-xs text-gray-400">
                    {c.lastResearchedAt ? `researched ${c.lastResearchedAt.toLocaleDateString()}` : "not yet researched"}
                  </span>
                </div>
                {c.notes && <div className="mt-1 text-xs text-gray-500">{c.notes}</div>}
              </div>
            ))}
          </div>
        ) : (
          <DataNotConnected label="Competitors" />
        )}
      </section>

      {/* Analytics — aggregate real campaign metrics only */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Analytics</h2>
        {campaigns.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><div className="text-gray-500">Total cost</div><div className="text-gray-900">{hasCostData ? totalCost.toLocaleString() : "Not recorded"}</div></div>
            <div><div className="text-gray-500">Total revenue</div><div className="text-gray-900">{hasRevenueData ? totalRevenue.toLocaleString() : "Not recorded"}</div></div>
            <div><div className="text-gray-500">Overall ROI</div><div className="text-gray-900">{overallRoi === null ? "Not available" : `${overallRoi}%`}</div></div>
          </div>
        ) : (
          <DataNotConnected label="Campaign analytics" />
        )}
      </section>

      {/* AI Recommendations — latest real generated report, not a live call on every page load */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">AI Recommendations</h2>
        {latestReport ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-medium text-gray-900">{latestReport.title}</h3>
              <StatusBadge status={latestReport.status} />
              <span className="text-xs text-gray-400">{latestReport.createdAt.toLocaleString()}</span>
            </div>
            {latestReport.summary && <p className="text-sm text-gray-700">{latestReport.summary}</p>}
            {latestReport.sections.length > 0 && (
              <div className="space-y-2">
                {latestReport.sections
                  .filter((s) => s.sectionType === "RECOMMENDATION")
                  .map((s) => (
                    <div key={s.id} className="rounded-md border border-gray-100 p-3 text-sm">
                      <div className="mb-1 font-medium text-gray-900">{s.title}</div>
                      <p className="whitespace-pre-line text-gray-700">{s.content}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <DataNotConnected label="Marketing report" />
        )}
        {pastReports.length > 1 && (
          <p className="mt-3 text-xs text-gray-400">{pastReports.length} marketing reports generated to date.</p>
        )}
      </section>
    </div>
  );
}
