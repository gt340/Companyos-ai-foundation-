import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const tiers = [
  {
    name: "Starter",
    price: "$0",
    cadence: "/month",
    description: "For a single team getting their company profile in order.",
    features: ["1 organization", "Up to 5 members", "Core onboarding", "Activity log (7 days)"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Growth",
    price: "$49",
    cadence: "/month",
    description: "For companies scaling teams, roles, and access control.",
    features: [
      "Unlimited teams",
      "Up to 50 members",
      "Full RBAC controls",
      "Unlimited activity history",
      "Priority support",
    ],
    cta: "Start free trial",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    description: "For organizations with compliance and scale requirements.",
    features: [
      "Unlimited members",
      "SSO & advanced security",
      "Dedicated onboarding",
      "Custom data retention",
      "SLA-backed support",
    ],
    cta: "Talk to sales",
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-b border-border/60 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">Pricing</p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Straightforward pricing, no surprises
          </h2>
          <p className="mt-4 text-muted-foreground">
            Billing is not active yet in this phase — plans below reflect the intended structure.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "flex flex-col rounded-lg border p-8",
                tier.featured ? "border-signal bg-signal/[0.03] shadow-lg" : "border-border bg-background",
              )}
            >
              {tier.featured && (
                <span className="mb-4 inline-flex w-fit items-center rounded-full bg-signal px-2.5 py-0.5 text-xs font-semibold text-signal-foreground">
                  Most popular
                </span>
              )}
              <h3 className="font-display text-lg font-semibold">{tier.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="font-display text-4xl font-semibold">{tier.price}</span>
                <span className="text-sm text-muted-foreground">{tier.cadence}</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
              <Button className="mt-8" variant={tier.featured ? "signal" : "outline"} asChild>
                <Link href="/register">{tier.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
