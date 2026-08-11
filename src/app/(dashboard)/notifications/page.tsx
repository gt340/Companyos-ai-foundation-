import { Bell } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const notifications = user
    ? await prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        title="Notifications"
        description="Invitations, billing events, and security alerts for your organization."
        actions={
          <Button variant="outline" size="sm" disabled={notifications.length === 0}>
            Mark all as read
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={Bell} title="You're all caught up" description="New notifications will appear here as they happen." />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => (
                <li key={n.id} className={cn("flex items-start gap-3 p-4", !n.isRead && "bg-signal/[0.03]")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.isRead ? "bg-transparent" : "bg-signal")} />
                  <div>
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-sm text-muted-foreground">{n.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{timeAgo(n.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
