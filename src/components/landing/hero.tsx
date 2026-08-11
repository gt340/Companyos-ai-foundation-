import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const modules = [
  { label: "Knowledge", detail: "Docs, wikis, files indexed" },
  { label: "Teams", detail: "Roles and access synced" },
  { label: "Workflows", detail: "Approvals routed" },
  { label: "Security", detail: "RBAC enforced" },
];

export function Hero() {
  return (
    <section className="signal-grid relative overflow-hidden border-b border-border/60 pb-24 pt-20 sm:pt-28">
      <div className="container relative">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex animate-fade-up items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-signal animate-signal-pulse" />
            Now onboarding companies to v1
          </div>

          <h1
            className="animate-fade-up text-balance font-display text-4xl font-semibold tracking-tight sm:text-6xl"
            style={{ animationDelay: "80ms" }}
          >
            The operating system<br className="hidden sm:block" /> for how your company runs.
          </h1>

          <p
            className="mx-auto mt-6 max-w-xl animate-fade-up text-balance text-lg text-muted-foreground"
            style={{ animationDelay: "160ms" }}
          >
            CompanyOS AI brings your knowledge, teams, and workflows into a single
            system of record — so every process in your company has a place to run.
          </p>

          <div
            className="mt-10 flex animate-fade-up flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: "240ms" }}
          >
            <Button size="lg" variant="signal" asChild>
              <Link href="/register">
                Start building your OS <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>
        </div>

        {/* Signature element: a boot-sequence status panel — the product
            framed literally as an operating system coming online. */}
        <div
          className="mx-auto mt-16 max-w-2xl animate-fade-up rounded-lg border border-border bg-card/60 p-1 shadow-xl backdrop-blur"
          style={{ animationDelay: "320ms" }}
        >
          <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
            <span className="ml-3 font-mono text-xs text-muted-foreground">companyos --status</span>
          </div>
          <div className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2">
            {modules.map((m, i) => (
              <div key={m.label} className="flex items-center justify-between bg-card px-4 py-3.5">
                <div className="text-left">
                  <p className="font-mono text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.detail}</p>
                </div>
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-signal-pulse"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
