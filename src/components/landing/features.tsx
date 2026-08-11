import { Boxes, GitBranch, ShieldCheck, Users, Activity, Bell } from "lucide-react";

const features = [
  {
    icon: Boxes,
    title: "One company profile",
    description:
      "Mission, products, services, and market context live in one place your whole company — and every workflow — reads from.",
  },
  {
    icon: Users,
    title: "Teams that mirror how you work",
    description: "Organizations, teams, and memberships map to how your company is actually structured, not a generic hierarchy.",
  },
  {
    icon: ShieldCheck,
    title: "Role-based access by default",
    description: "Owner, Admin, Member, and Viewer roles ship with sane permissions, so access control isn't an afterthought.",
  },
  {
    icon: GitBranch,
    title: "Built for what comes next",
    description: "A foundation designed to host AI agents and automated workflows once your company data is in place.",
  },
  {
    icon: Activity,
    title: "Full activity history",
    description: "Every change to your organization is logged — who did what, when, and from where.",
  },
  {
    icon: Bell,
    title: "Notifications that matter",
    description: "Invitations, billing events, and security alerts reach the right people without the noise.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-b border-border/60 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">Foundation</p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything a company needs before it can run on AI
          </h2>
          <p className="mt-4 text-muted-foreground">
            CompanyOS AI starts with the structural pieces every company already has —
            people, roles, and a profile of the business — modeled properly from day one.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="bg-background p-8 transition-colors hover:bg-muted/40">
              <f.icon className="h-5 w-5 text-signal" />
              <h3 className="mt-4 font-display text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
