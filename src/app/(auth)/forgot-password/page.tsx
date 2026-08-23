"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [values, setValues] = React.useState<ForgotPasswordInput>({ email: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = forgotPasswordSchema.safeParse(values);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Enter a valid email");
      return;
    }
    setError(null);
    setLoading(true);

    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(result.data.email, {
      redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent("/reset-password")}`,
    });

    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signal/10">
          <MailCheck className="h-5 w-5 text-signal" />
        </div>
        <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{values.email}</span>, we sent a
          link to reset your password.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-signal">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your email and we'll send you a link to reset it.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(e) => setValues({ email: e.target.value })}
            aria-invalid={Boolean(error)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <Button type="submit" variant="signal" className="w-full" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Send reset link
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground hover:text-signal">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
