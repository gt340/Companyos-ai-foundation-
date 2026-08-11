"use client";

import * as React from "react";
import Link from "next/link";
import { MailCheck, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-current-user";

export default function VerifyEmailPage() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [resending, setResending] = React.useState(false);

  async function resend() {
    if (!user?.email) return;
    setResending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email: user.email });
    setResending(false);

    if (error) {
      toast({ variant: "destructive", title: "Couldn't resend", description: error.message });
      return;
    }
    toast({ variant: "success", title: "Verification email sent" });
  }

  return (
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signal/10">
        <MailCheck className="h-5 w-5 text-signal" />
      </div>
      <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">Verify your email</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We sent a verification link to{" "}
        <span className="font-medium text-foreground">{user?.email ?? "your inbox"}</span>. Click it to activate
        your account.
      </p>

      <Button variant="outline" className="mt-6" onClick={resend} disabled={resending || !user?.email}>
        <RefreshCw className={resending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        Resend verification email
      </Button>

      <p className="mt-8 text-sm text-muted-foreground">
        Wrong account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:text-signal">
          Sign in again
        </Link>
      </p>
    </div>
  );
}
