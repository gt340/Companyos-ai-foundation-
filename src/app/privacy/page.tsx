import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How CompanyOS AI collects, uses, stores, and protects personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-foreground">
      <nav className="mb-8 text-sm text-muted-foreground"><Link href="/">CompanyOS AI</Link> / Privacy Policy</nav>
      <h1 className="mb-3 text-4xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mb-8 text-sm text-muted-foreground">Effective date: October 22, 2026</p>
      <p className="mb-5">This Privacy Policy explains how Trust God Company (“CompanyOS,” “we,” “us,” or “our”) processes personal information when you use CompanyOS AI and its integrations, including the CompanyOS Zoom integration.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Information we process</h2>
      <ul className="mb-5 list-disc space-y-2 pl-6">
        <li><strong>Account and organization information:</strong> details you provide when registering, signing in, joining an organization, or managing your profile, such as your name, email address, role, and organization settings.</li>
        <li><strong>Integration information:</strong> when you connect Zoom, we receive information made available through the permissions you approve, such as your Zoom user profile and meeting information needed to create, list, or delete meetings. OAuth credentials or tokens are used to maintain the connection.</li>
        <li><strong>Content you submit:</strong> information, files, prompts, and other content you choose to provide to CompanyOS features.</li>
        <li><strong>Technical and security data:</strong> device/browser information, logs, and events needed to operate the service, troubleshoot issues, prevent abuse, and protect accounts.</li>
      </ul>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">How we use information</h2>
      <p className="mb-5">We use information to provide and maintain CompanyOS, authenticate users, administer organizations and permissions, deliver requested integrations, respond to support requests, secure the service, diagnose errors, comply with legal obligations, and improve functionality. We do not use Zoom data for purposes unrelated to providing or maintaining the features you authorize.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Zoom access and choices</h2>
      <p className="mb-5">Connecting Zoom requires your authorization. CompanyOS uses only the permissions granted to the integration. You can disconnect Zoom through CompanyOS when that control is available, or remove/revoke the app from your Zoom account. Revoking access prevents future access through that authorization, but does not automatically remove information already stored in CompanyOS; contact us to request deletion.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Sharing and service providers</h2>
      <p className="mb-5">We do not sell personal information. We may disclose information to infrastructure, database, authentication, AI, and other service providers only as needed to operate features you request; to organization administrators where appropriate to the organization’s use of CompanyOS; to comply with law; to protect rights and safety; or in connection with a business transfer. Third-party services process information under their own terms and privacy policies.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Storage and security</h2>
      <p className="mb-5">We use access controls and technical safeguards intended to protect information. OAuth tokens are handled by the application’s credential-protection mechanisms. No method of transmission or storage is completely secure, and we cannot guarantee absolute security. Information is retained for as long as needed to provide the service, meet legitimate operational needs, resolve disputes, and comply with legal obligations, then deleted or de-identified where reasonably practicable.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">International processing</h2>
      <p className="mb-5">CompanyOS and its service providers may process information in countries other than the country where you live. Where required, we will use appropriate safeguards for international transfers.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Your privacy rights</h2>
      <p className="mb-5">Depending on your location, you may have rights to request access to, correction of, deletion of, or a copy of your personal information; object to or restrict certain processing; withdraw consent where processing relies on consent; or lodge a complaint with a supervisory authority. To exercise a right, contact us using the details below. We may need to verify your identity and will respond as required by applicable law.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Children</h2>
      <p className="mb-5">CompanyOS is a business service and is not intended for children who are not legally able to use it.</p>
      <h2 className="mb-2 mt-8 text-2xl font-semibold">Changes and contact</h2>
      <p className="mb-5">We may update this policy as the service changes. We will update the effective date when we do. For privacy questions or requests, contact Trust God Company at <a className="underline" href="mailto:trustgodcompany123@gmail.com">trustgodcompany123@gmail.com</a>.</p>
      <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground"><Link className="underline" href="/terms">Terms of Use</Link> · <Link className="underline" href="/support">Support</Link></footer>
    </main>
  );
}
