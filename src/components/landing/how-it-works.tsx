const steps = [
  {
    label: "Create your organization",
    detail: "Register, verify your email, and your organization is provisioned with default roles and permissions.",
  },
  {
    label: "Onboard your company",
    detail: "Tell CompanyOS about your industry, products, mission, and market — the profile every future workflow reads from.",
  },
  {
    label: "Invite your team",
    detail: "Bring in teammates, assign roles, and organize them into teams that match how you actually work.",
  },
  {
    label: "Operate from one dashboard",
    detail: "Track activity, manage settings, and keep a single source of truth as your company grows.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-border/60 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">Sequence</p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            From sign-up to a running company OS
          </h2>
        </div>

        <ol className="mx-auto mt-16 max-w-3xl">
          {steps.map((step, i) => (
            <li key={step.label} className="flex gap-6 border-l border-border pb-12 pl-8 last:pb-0" style={{ position: "relative" }}>
              <span className="absolute -left-[9px] top-0 flex h-4 w-4 items-center justify-center rounded-full border-2 border-signal bg-background" />
              <div>
                <p className="font-mono text-xs text-muted-foreground">Step {i + 1}</p>
                <h3 className="mt-1 font-display text-lg font-semibold">{step.label}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
