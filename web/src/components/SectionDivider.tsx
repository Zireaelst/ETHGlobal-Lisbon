/**
 * The seam between sections — a thin warm-to-cool line with a centered
 * mark, echoing the hero's own scroll rail. Exists so the page reads as
 * one continuous piece rather than a stack of independent blocks.
 */
export function SectionDivider() {
  return (
    <div
      aria-hidden="true"
      className="section relative flex items-center justify-center py-2"
    >
      <div className="h-px w-24 bg-gradient-to-r from-transparent via-warm to-transparent opacity-40 sm:w-40" />
      <div className="mx-3 h-1.5 w-1.5 rotate-45 border border-cool opacity-60" />
      <div className="h-px w-24 bg-gradient-to-r from-transparent via-cool to-transparent opacity-40 sm:w-40" />
    </div>
  );
}
