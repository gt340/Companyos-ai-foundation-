"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  roleKey: string;
}

export function WorkspaceSwitcher() {
  const router = useRouter();
  const { toast } = useToast();
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [switching, setSwitching] = React.useState(false);

  const loadWorkspaces = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/organizations");
    if (res.ok) {
      const body = await res.json();
      setWorkspaces(body.organizations ?? []);
      // The active org isn't in this response; the settings/workspace API
      // knows it via the server-side cookie, so ask it directly.
      const activeRes = await fetch("/api/workspace");
      if (activeRes.ok) {
        const activeBody = await activeRes.json();
        setActiveId(activeBody.organization?.id ?? body.organizations?.[0]?.id ?? null);
      }
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const active = workspaces.find((w) => w.id === activeId) ?? null;

  async function handleSwitch(ws: Workspace) {
    if (ws.id === activeId) return;
    setSwitching(true);

    const res = await fetch("/api/workspace/active", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: ws.id }),
    });

    setSwitching(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast({ variant: "destructive", title: "Couldn't switch workspace", description: body?.error });
      return;
    }

    setActiveId(ws.id);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={loading}
        className="flex max-w-[200px] items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {loading || switching ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-signal/10 text-[10px] font-semibold text-signal">
            {active?.name?.[0]?.toUpperCase() ?? "?"}
          </span>
        )}
        <span className="truncate">{active?.name ?? "Select workspace"}</span>
        <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.length === 0 && !loading && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No organizations yet</p>
        )}
        {workspaces.map((ws) => (
          <DropdownMenuItem key={ws.id} onClick={() => handleSwitch(ws)} className="justify-between">
            <span className="truncate">{ws.name}</span>
            {active?.id === ws.id && <Check className="h-4 w-4 shrink-0 text-signal" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/onboarding")}>
          <Plus className="mr-2 h-4 w-4" /> Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
                                           }
