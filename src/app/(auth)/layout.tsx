import { Logo } from "@/components/shared/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:mx-auto sm:w-full sm:max-w-md">
        <Logo className="mx-auto" />
        <div className="mt-10">{children}</div>
      </div>
      <div className="signal-grid relative hidden flex-1 border-l border-border bg-card lg:flex lg:items-center lg:justify-center">
        <div className="max-w-sm px-8 text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">System status</p>
          <p className="mt-3 font-display text-2xl font-semibold tracking-tight">
            One account. Every organization you belong to.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Sign in once and switch between companies from your workspace selector.
          </p>
        </div>
      </div>
    </div>
  );
}
