"use client";

import * as React from "react";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const roleLabels: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export default function SettingsPage() {
  const [notifyNewMember, setNotifyNewMember] = React.useState(true);
  const [notifyBilling, setNotifyBilling] = React.useState(true);
  const [requireTwoFactor, setRequireTwoFactor] = React.useState(false);

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
                <Input id="orgName" placeholder="Acme Inc." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgSlug">URL slug</Label>
                <Input id="orgSlug" placeholder="acme-inc" />
                <p className="text-xs text-muted-foreground">Used in workspace URLs. Lowercase letters, numbers, and hyphens only.</p>
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t border-border pt-6">
              <Button variant="signal">Save changes</Button>
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
              <Button size="sm" variant="signal">
                <UserPlus className="h-4 w-4" /> Invite member
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">You</p>
                  <p className="text-xs text-muted-foreground">Signed-in account</p>
                </div>
                <Badge variant="signal">{roleLabels.OWNER}</Badge>
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Invite teammates to see them listed here.
              </p>
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
                <Switch checked={requireTwoFactor} onCheckedChange={setRequireTwoFactor} />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="sessionTimeout">Session timeout</Label>
                <Select defaultValue="720">
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
              <Button variant="signal">Save changes</Button>
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
                <Switch checked={notifyNewMember} onCheckedChange={setNotifyNewMember} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Billing events</p>
                  <p className="text-sm text-muted-foreground">Notify owners about billing and subscription changes.</p>
                </div>
                <Switch checked={notifyBilling} onCheckedChange={setNotifyBilling} />
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t border-border pt-6">
              <Button variant="signal">Save changes</Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
