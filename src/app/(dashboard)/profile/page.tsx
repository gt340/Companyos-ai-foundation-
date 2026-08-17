"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { getInitials } from "@/lib/utils";
import { updateProfileSchema } from "@/lib/validations/organization";
import { useToast } from "@/hooks/use-toast";

interface Profile {
  fullName: string | null;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  avatarUrl: string | null;
  timezone: string;
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default function ProfilePage() {
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [values, setValues] = React.useState<Profile>({
    fullName: "",
    email: "",
    jobTitle: "",
    phone: "",
    avatarUrl: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetch("/api/profile")
      .then((res) => res.json())
      .then((body) => {
        if (body.profile) {
          setValues({
            fullName: body.profile.fullName ?? "",
            email: body.profile.email ?? "",
            jobTitle: body.profile.jobTitle ?? "",
            phone: body.profile.phone ?? "",
            avatarUrl: body.profile.avatarUrl ?? null,
            timezone: body.profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handlePhotoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file || !user) return;

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      toast({ variant: "destructive", title: "Unsupported file type", description: "Use JPEG, PNG, WEBP, or GIF." });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast({ variant: "destructive", title: "Image too large", description: "Max size is 5MB." });
      return;
    }

    setUploadingPhoto(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
      upsert: true,
      cacheControl: "3600",
    });

    if (uploadError) {
      setUploadingPhoto(false);
      toast({ variant: "destructive", title: "Upload failed", description: uploadError.message });
      return;
    }

    const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path);
    setValues((v) => ({ ...v, avatarUrl: publicUrlData.publicUrl }));
    setUploadingPhoto(false);
    toast({ variant: "success", title: "Photo uploaded — don't forget to Save changes" });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = updateProfileSchema.safeParse({
      fullName: values.fullName,
      jobTitle: values.jobTitle,
      phone: values.phone,
      timezone: values.timezone,
    });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) fieldErrors[issue.path[0] as string] = issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: values.fullName,
        jobTitle: values.jobTitle,
        phone: values.phone,
        timezone: values.timezone,
        avatarUrl: values.avatarUrl ?? "",
      }),
    });

    setSaving(false);

    if (!response.ok) {
      toast({ variant: "destructive", title: "Couldn't save profile" });
      return;
    }

    toast({ variant: "success", title: "Profile updated" });
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-8">
        <PageHeader title="Profile" description="Manage how you appear across your organizations." />
        <Skeleton className="h-96 w-full" />
      </div>
    );
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
                <AvatarImage src={values.avatarUrl ?? undefined} />
                <AvatarFallback className="text-lg">{getInitials(values.fullName)}</AvatarFallback>
              </Avatar>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_AVATAR_TYPES.join(",")}
                className="hidden"
                onChange={handlePhotoSelected}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingPhoto}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingPhoto && <Loader2 className="h-4 w-4 animate-spin" />}
                Change photo
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={values.fullName ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))}
                />
                {errors.fullName && <p className="text-sm text-destructive">{errors.fullName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={values.email} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job title</Label>
                <Input
                  id="jobTitle"
                  value={values.jobTitle ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, jobTitle: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={values.phone ?? ""}
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
