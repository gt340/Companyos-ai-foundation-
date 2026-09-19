import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/active-org";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    PAUSED: "bg-yellow-100 text-yellow-800",
    ARCHIVED: "bg-gray-100 text-gray-600",
    DRAFT: "bg-gray-100 text-gray-600",
    GENERATING: "bg-blue-100 text-blue-800",
    COMPLETED: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        colors[status] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {status}
    </span>
  );
}

function SectionTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
      {type.replace(/_/g, " ")}
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

export default async function ExecutiveDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const organizationId = await getActiveOrganizationId(user.id);

  if (!organizationId) {
    redirect("/onboarding");
  }

  const [organization, company, agent, pastReports, recentMemories, memoryCount] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, slug: true },
      }),
      prisma.company.findUnique({ where: { organizationId } }),
      prisma.agent.findUnique({
        where: { organizationId_type: { organizationId, type: "CEO" } },
      }),
      prisma.executiveReport.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          status: true,
          reportingPeriod: true,
          createdAt: true,
        },
      }),
      prisma.agentMemory.findMany({
        where: { organizationId },
        orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
        take: 5,
      }),
      prisma.agentMemory.count({ where: { organizationId } }),
    ]);

  const latestReport = agent
    ? await prisma.executiveReport.findFirst({
        where: { organizationId, agentId: agent.id },
        orderBy: { createdAt: "desc" },
        include: { sections: { orderBy: { order: "asc" } } },
      })
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Executive Dashboard
        </h1>
        <p className="text-sm text-gray-500">
          {organization?.name ?? "Your organization"} — CEO Agent overview
        </p>
      </div>

      {/* CEO Agent status */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">CEO Agent</h2>
        {agent ? (
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
            <div>
              <span className="text-gray-500">Status: </span>
              <StatusBadge status={agent.status} />
            </div>
            <div>
              <span className="text-gray-500">Name: </span>
              {agent.name}
            </div>
            <div>
              <span className="text-gray-500">Active since: </span>
              {agent.createdAt.toLocaleDateString()}
            </div>
            <div>
              <span className="text-gray-500">Stored memories: </span>
              {memoryCount}
            </div>
          </div>
        ) : (
          <DataNotConnected label="CEO Agent" />
        )}
        <div className="mt-4">
          <Link
            href="/assistant"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Open CEO Assistant →
          </Link>
        </div>
      </section>

      {/* Company overview */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">
          Company Overview
        </h2>
        {company ? (
          <div className="space-y-3 text-sm text-gray-700">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <div className="text-gray-500">Industry</div>
                <div>{company.industry}</div>
              </div>
              <div>
                <div className="text-gray-500">Size</div>
                <div>{company.businessSize}</div>
              </div>
              <div>
                <div className="text-gray-500">Employees</div>
                <div>{company.employeeCount ?? "—"}</div>
              </div>
            </div>
            {company.mission && (
              <div>
                <div className="text-gray-500">Mission</div>
                <div>{company.mission}</div>
              </div>
            )}
            {company.vision && (
              <div>
                <div className="text-gray-500">Vision</div>
                <div>{company.vision}</div>
              </div>
            )}
            {company.goals.length > 0 && (
              <div>
                <div className="text-gray-500">Goals</div>
                <ul className="list-inside list-disc">
                  {company.goals.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
            {(company.products.length > 0 || company.services.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {company.products.length > 0 && (
                  <div>
                    <div className="text-gray-500">Products</div>
                    <ul className="list-inside list-disc">
                      {company.products.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {company.services.length > 0 && (
                  <div>
                    <div className="text-gray-500">Services</div>
                    <ul className="list-inside list-disc">
                      {company.services.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <DataNotConnected label="Company profile" />
        )}
      </section>

      {/* Latest report */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">
          Latest Executive Report
        </h2>
        {latestReport ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-medium text-gray-900">
                {latestReport.title}
              </h3>
              <StatusBadge status={latestReport.status} />
              {latestReport.reportingPeriod && (
                <span className="text-xs text-gray-500">
                  {latestReport.reportingPeriod}
                </span>
              )}
              <span className="text-xs text-gray-400">
                {latestReport.createdAt.toLocaleString()}
              </span>
            </div>
            {latestReport.status === "FAILED" && latestReport.errorMessage && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {latestReport.errorMessage}
              </div>
            )}
            {latestReport.summary && (
              <p className="text-sm text-gray-700">{latestReport.summary}</p>
            )}
            {latestReport.sections.length > 0 && (
              <div className="space-y-3">
                {latestReport.sections.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-md border border-gray-100 p-3"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <SectionTypeBadge type={s.sectionType} />
                      <span className="text-sm font-medium text-gray-900">
                        {s.title}
                      </span>
                    </div>
                    <p className="whitespace-pre-line text-sm text-gray-700">
                      {s.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <DataNotConnected label="Executive report" />
        )}
      </section>

      {/* Past reports */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">
          Past Reports
        </h2>
        {pastReports.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-2 font-medium">Title</th>
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {pastReports.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-2 text-gray-900">{r.title}</td>
                    <td className="py-2 text-gray-500">
                      {r.reportingPeriod ?? "—"}
                    </td>
                    <td className="py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 text-gray-500">
                      {r.createdAt.toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <DataNotConnected label="Report history" />
        )}
      </section>

      {/* Recent CEO memory */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">
          Recent CEO Memory
        </h2>
        {recentMemories.length > 0 ? (
          <ul className="space-y-2">
            {recentMemories.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2 text-sm"
              >
                <div>
                  <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                    {m.type.replace(/_/g, " ")}
                  </span>
                  {m.content}
                </div>
                <div className="shrink-0 text-xs text-gray-400">
                  importance {m.importance}/5
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <DataNotConnected label="Agent memory" />
        )}
      </section>

      {/* KPI / Sales / Financial — deliberately not fabricated per spec */}
      <section className="grid gap-4 sm:grid-cols-3">
        <DataNotConnected label="KPIs" />
        <DataNotConnected label="Sales" />
        <DataNotConnected label="Financials" />
      </section>
    </div>
  );
}
