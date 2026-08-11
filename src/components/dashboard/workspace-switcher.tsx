"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// In this foundation phase a signed-in user has a single active
// organization from onboarding; this list is what /api/organizations
// returns once a user has multiple memberships.
interface Workspace {
  id: string;
  name: string;
}

export function WorkspaceSwitcher({ workspaces = [] }: { workspaces?: Workspace[] }) {
  const [active, setActive] = React.useState<Workspace | null>(workspaces[0] ?? null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex max-w-[200px] items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-signal/10 text-[10px] font-semibold text-signal">
          {active?.name?.[0]?.toUpperCase() ?? "?"}
        </span>
        <span className="truncate">{active?.name ?? "Select workspace"}</span>
        <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No organizations yet</p>
        )}
        {workspaces.map((ws) => (
          <DropdownMenuItem key={ws.id} onClick={() => setActive(ws)} className="justify-between">
            {ws.name}
            {active?.id === ws.id && <Check className="h-4 w-4 text-signal" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Plus className="mr-2 h-4 w-4" /> Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
