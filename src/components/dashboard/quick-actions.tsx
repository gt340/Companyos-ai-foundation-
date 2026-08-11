import Link from "next/link";
import { Building2, UserPlus, FileText, Settings } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const actions = [
  { label: "Complete company profile", href: "/onboarding", icon: Building2 },
  { label: "Invite a teammate", href: "/settings", icon: UserPlus },
  { label: "View activity logs", href: "/activity-logs", icon: FileText },
  { label: "Organization settings", href: "/settings", icon: Settings },
];

export function QuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quick actions</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.label}
            href={action.href}
            className="flex items-center gap-3 rounded-md border border-border p-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            <action.icon className="h-4 w-4 text-signal" />
            {action.label}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
