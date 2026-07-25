"use client";

import { explorerFor, explorerName, type Kind, type Network } from "@/lib/explorers";
import { short } from "@/lib/run-types";

/**
 * A hash or identifier, linked to the explorer that proves it exists.
 *
 * Two behaviours, and the second is the point:
 *   - With an explorer page, it renders a link that says where it goes, and the full value is
 *     in the title attribute so a judge can copy it rather than retype an ellipsis.
 *   - Without one, it renders plain monospace text. A value that is not on a public ledger must
 *     LOOK different from one that is, or the panel would be claiming proof it does not have.
 *
 * `why` exists for the second case: instead of a dead-looking string, it can explain in one
 * clause why this particular thing has no explorer page (see the callers for the wording).
 */
export function Hash({
  value,
  network,
  kind = "tx",
  lead = 10,
  tail = 6,
  why,
  href: hrefOverride,
  goesTo,
}: {
  value: string | null | undefined;
  network?: Network;
  kind?: Kind;
  lead?: number;
  tail?: number;
  /** Shown as a tooltip when there is deliberately no link. */
  why?: string;
  /**
   * A destination that is not an explorer page but is still checkable — an event log anchor, a
   * mirror-node record, a facilitator's capability document. Worth linking: the first pass of
   * this component was too strict and left values inert that a judge could in fact verify.
   */
  href?: string | null;
  /** Where `href` goes, named in the tooltip so a click is never a surprise. */
  goesTo?: string;
}) {
  const href = hrefOverride ?? (network ? explorerFor(network, kind, value) : null);

  if (!value) return <span className="font-mono text-muted-foreground">—</span>;

  if (!href) {
    return (
      <span
        title={why ? `${value}\n\n${why}` : value}
        className={`font-mono ${why ? "cursor-help decoration-dotted underline-offset-4 [text-decoration-line:underline] decoration-border" : ""}`}
      >
        {short(value, lead, tail)}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`${value}\n\nOpens ${goesTo ?? (network ? `on ${explorerName(network)}` : "an external page")}`}
      className="font-mono text-cool underline decoration-cool/35 underline-offset-4 transition hover:decoration-cool"
    >
      {short(value, lead, tail)}
    </a>
  );
}
