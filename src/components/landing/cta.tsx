import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="py-24">
      <div className="container">
        <div className="signal-grid relative overflow-hidden rounded-lg border border-border bg-card px-8 py-16 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Give your company a foundation worth building on
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Set up your organization and onboard your company profile in minutes.
          </p>
          <Button size="lg" variant="signal" className="mt-8" asChild>
            <Link href="/register">
              Create your organization <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
