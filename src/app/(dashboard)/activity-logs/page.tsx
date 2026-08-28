import { Activity } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/utils";
import { getActiveOrganizationId } from "@/lib/active-org";

const categoryVariant: Record<string, "default" | "secondary" | "destructive" | "outline" | "signal"> = {
  AUTH: "secondary",
  ORGANIZATION: "signal",
  COMPANY: "signal",
  TEAM: "secondary",
  MEMBER: "secondary",
  BILLING: "outline",
  SETTINGS: "outline",
  SECURITY: "destructive",
  SYSTEM: "outline",
};

export default async function ActivityLogsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = user
    ? await prisma.membership.findFirst({
        where: {
          userId: user.id,
          isActive: true,
          organizationId: (await getActiveOrganizationId(user.id)) ?? undefined,
        },
      })
    : null;

  const logs = membership
    ? await prisma.activityLog.findMany({
        where: { organizationId: membership.organizationId },
        include: { actor: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Activity logs" description="A record of changes made across your organization." />

      <Card>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Activity}
                title="No activity recorded yet"
                description="Actions like inviting members or updating your company profile will show up here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {logs.map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="text-sm">
                      <span className="font-medium">{log.actor?.fullName ?? log.actor?.email ?? "System"}</span>{" "}
                      <span className="text-muted-foreground">{log.action}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{timeAgo(log.createdAt)}</p>
                  </div>
                  <Badge variant={categoryVariant[log.category] ?? "outline"}>{log.category}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
