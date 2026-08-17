"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);

  async function handleAccept() {
    setLoading(true);
    const res = await fetch(`/api/invitations/${token}/accept`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      toast({ variant: "destructive", title: "Couldn't accept invitation", description: body?.error });
      return;
    }

    setAccepted(true);
    toast({ variant: "success", title: "You're in!" });
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1200);
  }

  if (accepted) {
    return (
      <div className="flex items-center justify-center gap-2 text-emerald-600">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-sm font-medium">Joined — taking you to your dashboard…</span>
      </div>
    );
  }

  return (
    <Button variant="signal" size="lg" className="w-full" disabled={loading} onClick={handleAccept}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      Accept invitation
    </Button>
  );
  }
