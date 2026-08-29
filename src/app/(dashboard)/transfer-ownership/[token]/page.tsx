"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Crown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-current-user";

export default function TransferOwnershipPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const [accepting, setAccepting] = React.useState(false);

  async function handleAccept() {
    setAccepting(true);
    const res = await fetch("/api/workspace/transfer-ownership/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: params.token }),
    });

    const body = await res.json().catch(() => null);
    setAccepting(false);

    if (!res.ok) {
      toast({ variant: "destructive", title: "Couldn't accept transfer", description: body?.error });
      return;
    }

    toast({ variant: "success", title: "You're now the owner" });
    router.push("/dashboard");
    router.refresh();
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(`/login?redirectTo=${encodeURIComponent(`/transfer-ownership/${params.token}`)}`);
  }

  return (
    <div className="mx-auto max-w-md pt-16">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signal/10">
            <Crown className="h-5 w-5 text-signal" />
          </div>
          <CardTitle className="mt-4">Ownership transfer</CardTitle>
          <CardDescription>
            {user
              ? `You're signed in as ${user.email}. Accepting will make you the owner of this organization.`
              : "Sign in with the email this transfer was sent to, then come back to this link."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {user ? (
            <>
              <Button variant="signal" className="w-full" onClick={handleAccept} disabled={accepting}>
                {accepting && <Loader2 className="h-4 w-4 animate-spin" />}
                Accept and become owner
              </Button>
              <Button variant="outline" className="w-full" onClick={handleSignOut}>
                Wrong account? Sign in with a different email
              </Button>
            </>
          ) : (
            <Button
              variant="signal"
              className="w-full"
              onClick={() => router.push(`/login?redirectTo=${encodeURIComponent(`/transfer-ownership/${params.token}`)}`)}
            >
              Sign in to continue
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
