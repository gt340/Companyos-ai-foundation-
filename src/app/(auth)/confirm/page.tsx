"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

function ConfirmForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") || "/onboarding";
  const [expired, setExpired] = React.useState(false);

  async function handleConfirm() {
    if (!code) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    setLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Couldn't confirm your account",
        description: error.message || "This link may have expired — request a new one.",
      });
      setExpired(true);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  if (!code) {
    return (
      <div className="text-center">
        <h1 className="font-display text-xl font-semibold tracking-tight">Invalid confirmation link</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This link is missing required information. Please request a new confirmation email.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signal/10">
        <MailCheck className="h-5 w-5 text-signal" />
      </div>
      <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">Confirm your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tap below to finish verifying your email address.
      </p>
      <Button variant="signal" className="mt-6 w-full" onClick={handleConfirm} disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Confirm my account
        {expired && (
        <p className="mt-4 text-sm text-muted-foreground">
          <Link href="/verify-email" className="font-medium text-foreground hover:text-signal">
            Resend verification email
          </Link>
        </p>
      )}
      </Button>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <React.Suspense fallback={null}>
      <ConfirmForm />
    </React.Suspense>
  );
}
