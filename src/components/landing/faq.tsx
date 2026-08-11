"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const faqs = [
  {
    q: "What exactly is live in this phase?",
    a: "Authentication, organization and company onboarding, team and role management, settings, notifications, and activity logs. AI agents and automated workflows are planned for a later phase and are not part of this build.",
  },
  {
    q: "How does access control work?",
    a: "Every organization gets four system roles — Owner, Admin, Member, and Viewer — each mapped to a fixed set of permissions. Membership, not raw login, is what determines what a person can see or do inside an organization.",
  },
  {
    q: "Can one person belong to more than one company?",
    a: "Yes. A user account can hold separate memberships in multiple organizations, each with its own role, switching between them from the workspace selector.",
  },
  {
    q: "Is my company's data isolated from others?",
    a: "Yes. Every record in the schema is scoped to an organization, and access is enforced both at the application layer and through role permissions.",
  },
  {
    q: "What happens to the onboarding data I enter?",
    a: "It becomes your company's profile — mission, products, services, and market context — that later phases of the product will build on.",
  },
];

export function FAQ() {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <section id="faq" className="border-b border-border/60 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">FAQ</p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Questions about this phase
          </h2>
        </div>

        <div className="mx-auto mt-12 max-w-2xl divide-y divide-border border-y border-border">
          {faqs.map((item, i) => (
            <div key={item.q}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between py-5 text-left"
                aria-expanded={open === i}
              >
                <span className="text-sm font-medium">{item.q}</span>
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open === i && "rotate-180")}
                />
              </button>
              {open === i && <p className="pb-5 text-sm text-muted-foreground">{item.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
