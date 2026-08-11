const quotes = [
  {
    quote:
      "We had our company profile, roles, and first three teams set up before lunch. It felt like flipping a switch on how we organize ourselves.",
    name: "Priya Nandakumar",
    role: "COO, Fieldstone Logistics",
  },
  {
    quote:
      "The permission model matched how we already thought about access — we didn't have to bend our org chart to fit the tool.",
    name: "Marcus Webb",
    role: "Head of Ops, Larkspur Health",
  },
  {
    quote:
      "Activity logs alone justified the switch. We finally have one place to see who changed what across the company.",
    name: "Elena Torres",
    role: "IT Director, Northbeam Manufacturing",
  },
];

export function Testimonials() {
  return (
    <section className="border-b border-border/60 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">Early access</p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Companies building their foundation with us
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {quotes.map((t) => (
            <figure key={t.name} className="flex flex-col rounded-lg border border-border p-8">
              <blockquote className="flex-1 text-sm leading-relaxed text-foreground">"{t.quote}"</blockquote>
              <figcaption className="mt-6 border-t border-border pt-4">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
