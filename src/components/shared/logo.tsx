import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 font-display font-semibold", className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-signal text-signal-foreground">
        <span className="h-2 w-2 rounded-sm bg-current" />
      </span>
      <span className="text-base tracking-tight">
        CompanyOS<span className="text-signal">.</span>
      </span>
    </Link>
  );
}
