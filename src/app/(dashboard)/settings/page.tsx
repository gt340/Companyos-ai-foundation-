"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, Copy } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const roleLabels: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

interface WorkspaceData {
  organization: { id: string; name: string; slug: string } | null;
  settings: {
    requireTwoFactor: boolean;
    sessionTimeoutMinutes: number;
    notifyOnNewMember: boolean;
    notifyOnBillingEvents: boolean;
  } | null;
  currentRole: string;
  permissions: string[];
  members: {
    id: string;
    fullName: string | null;
    email: string;
    roleKey: string;
    isCurrentUser: boolean;
  }[];
  invitations: { id: string; email: string; roleKey: string; expiresAt: string }[];
}

async function fetchWorkspace(): Promise<WorkspaceData> {
  const res = await fetch("/api/workspace");
  if (!res.ok) throw new Error("Failed to load workspace");
  return res.json();
}

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["workspace"], queryFn: fetchWorkspace });

  const canManage = data?.permissions.includes("organization.manage") ?? false;
  const canInvite = data?.permissions.includes("member.invite") ?? false;

  const [orgForm, setOrgForm] = React.useState({ name: "", slug: "" });
  const [inviteOpen, setInviteOpen] = React.useState(false);

  React.useEffect(() => {
    if (data?.organization) {
      setOrgForm({ name: data.organization.name, slug: data.organization.slug });
    }
  }, [data?.organization]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["workspace"] });

  const orgMutation = useMutation({
    mutationFn: (body: typeof orgForm) =>
      fetch("/api/workspace/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Save failed");
        return res.json();
      }),
    onSuccess: () => {
      toast({ variant: "success", title: "Organization updated" });
      invalidate();
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't save", description: err.message }),
  });

  const settingsMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch("/api/workspace/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Save failed");
        return res.json();
      }),
    onSuccess: () => {
      toast({ variant: "success", title: "Settings updated" });
      invalidate();
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't save", description: err.message }),
  });

  const [requireTwoFactor, setRequireTwoFactor] = React.useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = React.useState("720");
  const [notifyOnNewMember, setNotifyOnNewMember] = React.useState(true);
  const [notifyOnBillingEvents, setNotifyOnBillingEvents] = React.useState(true);

  React.useEffect(() => {
    if (data?.settings) {
      setRequireTwoFactor(data.settings.requireTwoFactor);
      setSessionTimeoutMinutes(String(data.settings.sessionTimeoutMinutes));
      setNotifyOnNewMember(data.settings.notifyOnNewMember);
      setNotifyOnBillingEvents(data.settings.notifyOnBillingEvents);
    }
  }, [data?.settings]);

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-8">
        <PageHeader title="Settings" description="Manage your organization, members, and security preferences." />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data?.organization) {
    return (
      <div className="max-w-3xl space-y-8">
        <PageHeader title="Settings" description="Manage your organization, members, and security preferences." />
        <p className="text-sm text-muted-foreground">
          You don't have an organization yet — complete company onboarding first.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Settings" description="Manage your organization, members, and security preferences." />

      <Tabs defaultValue="organization">
        <TabsList>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="organization">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organization profile</CardTitle>
              <CardDescription>Basic details about your organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="orgName">Organization name</Label>
                <Input
                  id="orgName"
                  value={orgForm.name}
                  disabled={!canManage}
                  onChange={(e) => setOrgForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgSlug">URL slug</Label>
                <Input
                  id="orgSlug"
                  value={orgForm.slug}
                  disabled={!canManage}
                  onChange={(e) => setOrgForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
                />
                <p className="text-xs text-muted-foreground">Used in workspace URLs. Lowercase letters, numbers, and hyphens only.</p>
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t border-border pt-6">
              <Button
                variant="signal"
                disabled={!canManage || orgMutation.isPending}
                onClick={() => orgMutation.mutate(orgForm)}
              >
                {orgMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="members">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Members</CardTitle>
                <CardDescription>People with access to this organization.</CardDescription>
              </div>
              {canInvite && (
                <Button size="sm" variant="signal" onClick={() => setInviteOpen(true)}>
                  <UserPlus className="h-4 w-4" /> Invite member
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {data.members.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {m.isCurrentUser ? "You" : m.fullName || m.email}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <Badge variant={m.roleKey === "OWNER" ? "signal" : "secondary"}>{roleLabels[m.roleKey]}</Badge>
                </div>
              ))}

              {data.invitations.length > 0 && (
                <>
                  <Separator />
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending invitations</p>
                  {data.invitations.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between rounded-md border border-dashed border-border p-3">
                      <div>
                        <p className="text-sm font-medium">{inv.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="outline">{roleLabels[inv.roleKey]}</Badge>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Security</CardTitle>
              <CardDescription>Session and access requirements for your organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Require two-factor authentication</p>
                  <p className="text-sm text-muted-foreground">All members must enable 2FA to access this organization.</p>
                </div>
                <Switch checked={requireTwoFactor} onCheckedChange={setRequireTwoFactor} disabled={!canManage} />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="sessionTimeout">Session timeout</Label>
                <Select value={sessionTimeoutMinutes} onValueChange={setSessionTimeoutMinutes} disabled={!canManage}>
                  <SelectTrigger id="sessionTimeout" className="max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="60">1 hour</SelectItem>
                    <SelectItem value="480">8 hours</SelectItem>
                    <SelectItem value="720">12 hours</SelectItem>
                    <SelectItem value="10080">7 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t border-border pt-6">
              <Button
                variant="signal"
                disabled={!canManage || settingsMutation.isPending}
                onClick={() =>
                  settingsMutation.mutate({
                    requireTwoFactor,
                    sessionTimeoutMinutes: Number(sessionTimeoutMinutes),
                  })
                }
              >
                {settingsMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notification preferences</CardTitle>
              <CardDescription>Choose what your organization gets notified about.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">New member joins</p>
                  <p className="text-sm text-muted-foreground">Notify admins when someone accepts an invitation.</p>
                </div>
                <Switch checked={notifyOnNewMember} onCheckedChange={setNotifyOnNewMember} disabled={!canManage} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Billing events</p>
                  <p className="text-sm text-muted-foreground">Notify owners about billing and subscription changes.</p>
                </div>
                <Switch checked={notifyOnBillingEvents} onCheckedChange={setNotifyOnBillingEvents} disabled={!canManage} />
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t border-border pt-6">
              <Button
                variant="signal"
                disabled={!canManage || settingsMutation.isPending}
                onClick={() => settingsMutation.mutate({ notifyOnNewMember, notifyOnBillingEvents })}
              >
                {settingsMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={invalidate} />
    </div>
  );
}

function InviteMemberDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [roleKey, setRoleKey] = React.useState("MEMBER");
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      fetch("/api/workspace/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleKey }),
      }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "Couldn't send invitation");
        return body;
      }),
    onSuccess: (body) => {
      setInviteUrl(body.invitation.inviteUrl);
      onInvited();
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't invite", description: err.message }),
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setEmail("");
      setRoleKey("MEMBER");
      setInviteUrl(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            {inviteUrl
              ? "Share this link with them — email delivery isn't connected yet, so this is the only way to send it for now."
              : "They'll get access once they accept the invitation."}
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-3">
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate text-xs text-signal underline"
            >
              {inviteUrl}
            </a>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(inviteUrl);
                toast({ title: "Copied" });
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inviteEmail">Email</Label>
              <Input id="inviteEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inviteRole">Role</Label>
              <Select value={roleKey} onValueChange={setRoleKey}>
                <SelectTrigger id="inviteRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="MEMBER">Member</SelectItem>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {inviteUrl ? (
            <Button variant="signal" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          ) : (
            <Button variant="signal" disabled={!email || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send invitation
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  }
