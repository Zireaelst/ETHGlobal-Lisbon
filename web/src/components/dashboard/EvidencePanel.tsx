"use client";

import { Panel, Chip } from "./Panel";
import { Hash } from "./Hash";
import { explorerName } from "@/lib/explorers";
import type { NetworkEvidence } from "@/lib/server/networks";

/**
 * "Here is exactly how we used your technology, and here is the link that proves it."
 *
 * Four sponsors, one job. For each: what it actually does in this system, which SDK does it, and
 * every identifier involved, clickable through to that network's own explorer.
 *
 * The panel is arranged so the honest gaps are as visible as the proofs. Two facts carry no
 * link on purpose — the 0G TEE signature and the x402 facilitator endpoint — and they say why
 * rather than being quietly omitted. A page that linked everything would be easier to build and
 * worth less: a judge who clicks one dead link stops believing the other nine.
 */
export function EvidencePanel({ evidence }: { evidence: NetworkEvidence[] }) {
  return (
    <Panel
      eyebrow="Proof · four networks"
      title="How each piece is actually used"
      subtitle="One job touches four networks and each does a distinct job — Base is the verdict, Hedera the timeline, The Graph the read layer, 0G the compute. Every identifier below opens on that network's own explorer."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {evidence.map((net) => (
          <article key={net.network} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg text-foreground">{net.sponsor}</h3>
              <Chip tone="cool">{explorerName(net.network)}</Chip>
            </div>

            <p className="mt-2.5 font-body text-sm font-light leading-relaxed text-muted-foreground">
              {net.what}
            </p>

            <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground opacity-75">
              {net.how}
            </p>

            <dl className="mt-4 space-y-2.5 border-t border-border/60 pt-3.5">
              {net.facts.map((fact) => (
                <div key={fact.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {fact.label}
                  </dt>
                  <dd className="min-w-0 text-sm">
                    {fact.kind === "text" || !fact.value ? (
                      <Hash value={fact.value ?? "—"} why={fact.why} href={fact.href} goesTo={fact.goesTo} lead={28} tail={0} />
                    ) : (
                      <Hash
                        value={fact.value}
                        network={net.network}
                        kind={fact.kind}
                        lead={net.network === "hedera" ? 20 : 10}
                        tail={net.network === "hedera" ? 0 : 6}
                      />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </Panel>
  );
}
