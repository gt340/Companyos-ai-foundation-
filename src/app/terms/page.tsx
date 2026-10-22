import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms governing access to CompanyOS AI and its integrations.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-foreground">
      <nav className="mb-8 text-sm text-muted-foreground"><Link href="/">CompanyOS AI</Link> / Terms of Use</nav>
      <h1 className="mb-3 text-4xl font-semibold tracking-tight">Terms of Use</h1>
      <p className="mb-8 text-sm text-muted-foreground">Effective date: October 22, 2026</p>
      <p className="mb-5">These Terms govern your access to CompanyOS AI and related integrations. “CompanyOS,” “we,” “us,” and “our” refer to Trust God Company. By using the service, you agree to these Terms. If you use CompanyOS for an organization, you represent that you are authorized to accept these Terms for that organization.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Accounts and authorized use</h2>
      <p className="mb-5">Provide accurate account information, keep your sign-in credentials confidential, and promptly notify us of suspected unauthorized access. You are responsible for activity under your account and for ensuring that members of your organization receive appropriate access.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Acceptable use</h2>
      <p className="mb-5">Do not misuse the service, attempt unauthorized access, interfere with its operation, violate another person’s rights, upload unlawful or malicious content, or use integrations in ways that violate applicable law or third-party terms.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Third-party integrations</h2>
      <p className="mb-5">Connecting a third-party service, including Zoom, requires authorization and is subject to that provider’s terms, policies, availability, and permissions. You authorize CompanyOS to perform actions within the scopes you grant. You are responsible for confirming that you have authority to connect the relevant account and manage its data. You can revoke an integration’s access through the provider or CompanyOS where supported.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Your content</h2>
      <p className="mb-5">You retain rights you hold in content you submit. You grant us permission to host, process, transmit, and display that content only as reasonably necessary to provide, secure, and support the features you request. You must have the rights and permissions needed to submit the content.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Availability and changes</h2>
      <p className="mb-5">We may update or discontinue features to maintain or improve the service, comply with law, or address security concerns. We do not guarantee uninterrupted or error-free operation. We will provide notices where required by law.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Disclaimers and liability</h2>
      <p className="mb-5">To the extent permitted by applicable law, the service is provided on an “as available” basis without warranties not expressly stated in these Terms. Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited. Any other limitation of liability is subject to applicable law.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Suspension and termination</h2>
      <p className="mb-5">You may stop using CompanyOS at any time. We may suspend or restrict access where reasonably necessary to protect the service, comply with law, address abuse, or enforce these Terms. Upon termination, provisions that by their nature should continue will remain effective.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Changes and contact</h2>
      <p className="mb-5">We may revise these Terms by updating this page and its effective date. Questions can be sent to <a className="underline" href="mailto:trustgodcompany123@gmail.com">trustgodcompany123@gmail.com</a>.</p>
      <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground"><Link className="underline" href="/privacy">Privacy Policy</Link> · <Link className="underline" href="/support">Support</Link></footer>
    </main>
  );
}
