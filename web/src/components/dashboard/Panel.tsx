import type { ReactNode } from "react";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { cn } from "@/lib/utils";

/**
 * The shared frame for all six panels. It exists so the dashboard reads as one instrument
 * rather than five widgets, and so the one rule that matters is enforced in a single place:
 * the alert tint is reserved for a rejected verdict and nothing else, so red always means
 * "the chain said no" (see theme-tokens.ts).
 */
export function Panel({
  eyebrow,
  title,
  subtitle,
  tint = "warm",
  actions,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  tint?: "warm" | "cool";
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-fill/40 p-5 sm:p-7 backdrop-blur-[2px]",
        className,
      )}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <SectionEyebrow tint={tint}>{eyebrow}</SectionEyebrow>
          <h2 className="mt-3 font-display text-xl sm:text-2xl font-normal text-foreground">{title}</h2>
          {subtitle ? (
            <p className="mt-2 max-w-2xl font-body text-sm font-light leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A small status chip. `tone` is meaningful, not decorative — see the note on Panel. */
export function Chip({
  tone = "neutral",
  children,
  title,
}: {
  tone?: "neutral" | "good" | "alert" | "cool";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
        tone === "neutral" && "border-border text-muted-foreground",
        tone === "good" && "border-warm/50 text-warm",
        tone === "cool" && "border-cool/50 text-cool",
        tone === "alert" && "border-alert/60 text-alert",
      )}
    >
      {children}
    </span>
  );
}

/** A labelled value in the panels' shared key/value idiom. */
export function Field({
  label,
  children,
  mono = true,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-sm text-foreground", mono ? "font-mono" : "font-body font-light")}>
        {children}
      </div>
    </div>
  );
}

/** An outbound link to a block explorer. Always shows where it goes. */
export function ProofLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-cool underline decoration-cool/40 underline-offset-4 transition hover:decoration-cool"
    >
      {children}
    </a>
  );
}
