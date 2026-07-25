import { cn } from "@/lib/utils";

/**
 * The same rule-plus-label motif the hero uses above its headline
 * ("Confidential Agents"), reused for every section below it so the whole
 * page reads as one typographic system instead of a new label style per
 * section.
 */
export function SectionEyebrow({
  children,
  tint = "warm",
  className,
}: {
  children: React.ReactNode;
  tint?: "warm" | "cool";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3.5", className)}>
      <div
        className={cn(
          "h-px w-9 bg-gradient-to-r from-transparent",
          tint === "warm" ? "to-warm" : "to-cool",
        )}
      />
      <span className="font-mono text-[11px] uppercase tracking-[0.34em] text-muted-foreground">
        {children}
      </span>
    </div>
  );
}
