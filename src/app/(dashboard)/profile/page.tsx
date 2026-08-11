"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { getInitials } from "@/lib/utils";
import { updateProfileSchema, type UpdateProfileInput } from "@/lib/validations/organization";
import { useToast } from "@/hooks/use-toast";

export default function ProfilePage() {
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [values, setValues] = React.useState<UpdateProfileInput>({
    fullName: "",
    jobTitle: "",
    phone: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setValues((v) => ({
        ...v,
        fullName: (user.user_metadata?.full_name as string | undefined) ?? "",
      }));
    }
  }, [user]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = updateProfileSchema.safeParse(values);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) fieldErrors[issue.path[0] as string] = issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    // Persisted via PATCH /api/profile in a future pass; this phase
    // validates and previews the update.
    await new Promise((r) => setTimeout(r, 400));
    setSaving(false);
    toast({ variant: "success", title: "Profile updated" });
  }

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader title="Profile" description="Manage how you appear across your organizations." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal information</CardTitle>
          <CardDescription>This information is visible to members of your organizations.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user?.user_metadata?.avatar_url as string | undefined} />
                <AvatarFallback className="text-lg">{getInitials(values.fullName)}</AvatarFallback>
              </Avatar>
              <Button type="button" variant="outline" size="sm">
                Change photo
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={values.fullName}
                  onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))}
                />
                {errors.fullName && <p className="text-sm text-destructive">{errors.fullName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user?.email ?? ""} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job title</Label>
                <Input
                  id="jobTitle"
                  value={values.jobTitle}
                  onChange={(e) => setValues((v) => ({ ...v, jobTitle: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={values.phone}
                  onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  value={values.timezone}
                  onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end border-t border-border pt-6">
            <Button type="submit" variant="signal" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
