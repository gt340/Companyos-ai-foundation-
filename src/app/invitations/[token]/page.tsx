import Link from "next/link";
import { Mail, ShieldCheck, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Logo } from "@/components/shared/logo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcceptInvitationButton } from "@/components/shared/accept-invitation-button";

const roleLabels: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { organization: true, invitedBy: true },
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-6 py-16">
      <Logo className="mb-8" />
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          {!invitation ? (
            <>
              <h1 className="font-display text-xl font-semibold">Invitation not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This invitation link is invalid. Ask whoever invited you to send a new one.
              </p>
            </>
          ) : invitation.status !== "PENDING" ? (
            <>
              <h1 className="font-display text-xl font-semibold">
                {invitation.status === "ACCEPTED" ? "Already accepted" : "Invitation no longer valid"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {invitation.status === "ACCEPTED"
                  ? "This invitation has already been used."
                  : "This invitation has expired or been revoked. Ask for a new one."}
              </p>
              {user && (
                <Button variant="outline" className="mt-6" asChild>
                  <Link href="/dashboard">Go to dashboard</Link>
                </Button>
              )}
            </>
          ) : invitation.expiresAt < new Date() ? (
            <>
              <Clock className="mx-auto h-8 w-8 text-muted-foreground" />
              <h1 className="mt-4 font-display text-xl font-semibold">Invitation expired</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This invitation expired on {invitation.expiresAt.toLocaleDateString()}. Ask{" "}
                {invitation.invitedBy.fullName || invitation.invitedBy.email} for a new one.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signal/10">
                <Mail className="h-5 w-5 text-signal" />
              </div>
              <h1 className="mt-4 font-display text-xl font-semibold">
                Join {invitation.organization.name}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {invitation.invitedBy.fullName || invitation.invitedBy.email} invited you as{" "}
                <span className="font-medium text-foreground">{roleLabels[invitation.roleKey]}</span>.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Invited: {invitation.email}</p>

              <div className="mt-8">
                {!user ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Sign in or create an account with <strong>{invitation.email}</strong> to accept.
                    </p>
                    <Button variant="signal" className="w-full" asChild>
                      <Link href={`/login?redirectTo=/invitations/${token}`}>Sign in</Link>
                    </Button>
                    <Button variant="outline" className="w-full" asChild>
                      <Link href="/register">Create an account</Link>
                    </Button>
                  </div>
                ) : user.email?.toLowerCase() !== invitation.email.toLowerCase() ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
                    <ShieldCheck className="mx-auto mb-2 h-5 w-5 text-destructive" />
                    You're signed in as <strong>{user.email}</strong>, but this invite was sent to{" "}
                    <strong>{invitation.email}</strong>. Sign out and sign in with the invited email to accept.
                  </div>
                ) : (
                  <AcceptInvitationButton token={token} />
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
