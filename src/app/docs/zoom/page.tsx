import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Zoom Integration Guide",
  description: "How to connect, use, and disconnect Zoom in CompanyOS AI.",
};

export default function ZoomGuidePage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-foreground">
      <nav className="mb-8 text-sm text-muted-foreground"><Link href="/">CompanyOS AI</Link> / Zoom Guide</nav>
      <h1 className="mb-3 text-4xl font-semibold tracking-tight">CompanyOS Zoom Integration Guide</h1>
      <p className="mb-8 text-sm text-muted-foreground">Updated October 22, 2026</p>
      <p className="mb-5">This guide explains the intended process for connecting a Zoom account to CompanyOS. Availability may depend on the app’s Zoom review status and the features enabled for your CompanyOS account.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Connect Zoom</h2>
      <ol className="mb-5 list-decimal space-y-2 pl-6">
        <li>Sign in to your CompanyOS account.</li>
        <li>Open the Integrations area and choose Zoom, if the integration is available.</li>
        <li>Review the permissions requested on Zoom’s authorization screen.</li>
        <li>Authorize only if you agree to the requested access. Zoom will return you to CompanyOS after authorization.</li>
      </ol>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Use the integration</h2>
      <p className="mb-5">When enabled for your account, CompanyOS can use the permissions you granted to create, list, and delete meetings and read the authorized user’s Zoom profile. Available actions depend on the scopes approved by Zoom and the features enabled in CompanyOS.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Disconnect or revoke access</h2>
      <p className="mb-5">Use the Zoom disconnect control in CompanyOS if it is available. You can also remove or revoke the app in your Zoom account’s connected-app settings. Revoking access stops future API access through that authorization; contact support if you also want to request deletion of information stored by CompanyOS.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Troubleshooting</h2>
      <p className="mb-5">If authorization fails, confirm that you are signing in to the intended Zoom account and that the app is available to that account. If the problem continues, contact support and include the error message and approximate time. Never send client secrets, access tokens, or passwords.</p>
      <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground"><Link className="underline" href="/privacy">Privacy Policy</Link> · <Link className="underline" href="/terms">Terms of Use</Link> · <Link className="underline" href="/support">Support</Link></footer>
    </main>
  );
}
