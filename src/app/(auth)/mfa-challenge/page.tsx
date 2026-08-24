"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [code, setCode] = React.useState("");
  const [verifying, setVerifying] = React.useState(false);
  const [factorId, setFactorId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const redirectTo = searchParams.get("redirectTo") || "/dashboard";

  React.useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.listFactors();

      if (error || !data) {
        setLoading(false);
        return;
      }

      const verified = data.totp.find((f) => f.status === "verified");
      if (!verified) {
        // No 2FA factor — nothing to challenge, continue straight through.
        router.push(redirectTo);
        return;
      }

      setFactorId(verified.id);
      setLoading(false);
    }
    load();
  }, [router, redirectTo]);

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId || code.length !== 6) return;

    setVerifying(true);
    const supabase = createClient();

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      toast({ variant: "destructive", title: "Couldn't start verification", description: challengeError.message });
      setVerifying(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    setVerifying(false);

    if (verifyError) {
      toast({ variant: "destructive", title: "Incorrect code", description: "Check your authenticator app and try again." });
      setCode("");
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  if (loading) {
    return <Loader2 className="h-5 w-5 animate-spin" />;
  }

  return (
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signal/10">
        <ShieldCheck className="h-5 w-5 text-signal" />
      </div>
      <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">Two-factor verification</h1>
      <p className="mt-2 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>

      <form onSubmit={handleVerify} className="mt-6 space-y-4 text-left">
        <div className="space-y-2">
          <Label htmlFor="mfa-code">Verification code</Label>
          <Input
            id="mfa-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            inputMode="numeric"
            autoFocus
          />
        </div>
        <Button type="submit" variant="signal" className="w-full" disabled={verifying || code.length !== 6}>
          {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
          Verify
        </Button>
      </form>
    </div>
  );
}

export default function MfaChallengePage() {
  return (
    <React.Suspense fallback={null}>
      <MfaChallengeForm />
    </React.Suspense>
  );
    }
