import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
}

export function StatCard({ label, value, icon: Icon, trend }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-6">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</p>
          {trend && (
            <p className={cn("mt-1 text-xs font-medium", trend.positive ? "text-emerald-600" : "text-destructive")}>
              {trend.value}
            </p>
          )}
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-signal/10">
          <Icon className="h-4 w-4 text-signal" />
        </div>
      </CardContent>
    </Card>
  );
}
