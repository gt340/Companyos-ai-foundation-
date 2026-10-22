import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with CompanyOS AI and its integrations.",
};

export default function SupportPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-foreground">
      <nav className="mb-8 text-sm text-muted-foreground"><Link href="/">CompanyOS AI</Link> / Support</nav>
      <h1 className="mb-3 text-4xl font-semibold tracking-tight">CompanyOS Support</h1>
      <p className="mb-8 text-muted-foreground">Contact Trust God Company for help with your CompanyOS account or integrations.</p>
      <section className="rounded-xl border p-6">
        <h2 className="mb-2 text-xl font-semibold">Contact support</h2>
        <p className="mb-3">Email: <a className="underline" href="mailto:trustgodcompany123@gmail.com">trustgodcompany123@gmail.com</a></p>
        <p className="text-sm text-muted-foreground">When reporting an issue, include the affected feature, the approximate time it occurred, and a description of the problem. Do not email passwords, OAuth client secrets, access tokens, or other credentials.</p>
      </section>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Zoom integration</h2>
      <p className="mb-5">To connect Zoom, sign in to CompanyOS and use the Zoom integration controls if they are available to your account. Review the permissions shown by Zoom before authorizing. To revoke access, disconnect Zoom in CompanyOS where supported or remove the app from your Zoom account.</p>
      <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground"><Link className="underline" href="/privacy">Privacy Policy</Link> · <Link className="underline" href="/terms">Terms of Use</Link></footer>
    </main>
  );
}
