import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Activity } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import type { ActivityLogEntry } from "@/types";

export function RecentActivity({ entries = [] }: { entries?: ActivityLogEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Actions taken across your organization will show up here."
          />
        ) : (
          <ul className="space-y-4">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
                <div>
                  <p>
                    <span className="font-medium">{entry.actorName ?? "System"}</span>{" "}
                    <span className="text-muted-foreground">{entry.action}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{timeAgo(entry.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
