"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = React.useState(searchParams.get("email") ?? "");
  const [sending, setSending] = React.useState(false);

  async function resend() {
    if (!email) return;
    setSending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setSending(false);

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
        Enter your email below to resend the confirmation link.
      </p>

      <div className="mt-6 space-y-2 text-left">
        <Label htmlFor="resend-email">Email</Label>
        <Input
          id="resend-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </div>

      <Button variant="outline" className="mt-4 w-full" onClick={resend} disabled={sending || !email}>
        {sending && <Loader2 className="h-4 w-4 animate-spin" />}
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

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={null}>
      <VerifyEmailForm />
    </React.Suspense>
  );
}
