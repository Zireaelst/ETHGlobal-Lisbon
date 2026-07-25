"use client";

import { Panel, Chip, Field, ProofLink } from "./Panel";
import { Hash } from "./Hash";
import { type RunView } from "@/lib/run-types";

/**
 * The split screen. Left: what actually happened. Right: everything a chain observer can see.
 *
 * The panel's argument is made by the GAP between the columns, so the right-hand side must be
 * built strictly from values that really are public — hashes, an event, a counter. Nothing is
 * redacted for effect: if a field appears on the right it is because it is genuinely on a public
 * network, and if it appears only on the left it is because only Alice and the enclave ever had it.
 *
 * The honest caveat, stated in the panel rather than buried: this shows confidentiality of
 * CONTENT. Base Sepolia still reveals that some address transacted with the verifier, and on the
 * Hedera run there is no stealth address at all (CLAUDE.md §11 — that run buys autonomy, not
 * privacy).
 */
export function SpyPanel({ run }: { run: RunView | null }) {
  const report = run?.report;

  return (
    <Panel
      eyebrow="Confidentiality"
      title="What happened · what anyone can see"
      subtitle="The same job, twice. On the left is the truth. On the right is every byte a chain observer gets."
      actions={
        run ? (
          run.live ? <Chip tone="cool">live run</Chip> : <Chip tone="neutral">recorded run</Chip>
        ) : (
          <Chip tone="neutral">waiting for a run</Chip>
        )
      }
    >
      {!report ? (
        <p className="font-body text-sm font-light text-muted-foreground">
          Run a job below and both columns fill from that one run.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---- what really happened ---- */}
          <div className="rounded-md border border-warm/30 bg-warm/[0.04] p-4">
            <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-warm">
              Only Alice and the enclave saw this
            </div>
            <div className="space-y-3.5">
              <Field label="The brief" mono={false}>
                Assess revenue-recognition risk in the attached quarterly figures.
              </Field>
              <Field label="The data" mono={false}>
                Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR; 41 contracts.
              </Field>
              <Field label="The delivered analysis" mono={false}>
                <span className="line-clamp-3 whitespace-pre-wrap break-words">{report.output}</span>
              </Field>
              <Field label="Who Alice hired, and why" mono={false}>
                {report.decisions?.hire ? (
                  <span className="line-clamp-3">
                    agent {report.decisions.hire.agentId} — {report.decisions.hire.rationale}
                  </span>
                ) : (
                  <span className="text-muted-foreground">ranked by verified deliveries (no model)</span>
                )}
              </Field>
            </div>
          </div>

          {/* ---- what an observer sees ---- */}
          <div className="rounded-md border border-border p-4">
            <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              On the public chain
            </div>
            <div className="space-y-3.5">
              <Field label="An intent commitment">
                <Hash
                  value={report.signedIntentHash}
                  lead={14}
                  tail={8}
                  href={report.basescanUrl ? `${report.basescanUrl}#eventlog` : null}
                  goesTo="the event log where an observer would find it"
                  why="No transaction was sent for this run."
                />
              </Field>
              <Field label="An output commitment">
                {report.match ? (
                  <Hash
                    value={report.bodyIntentHash}
                    lead={14}
                    tail={8}
                    href={report.basescanUrl ? `${report.basescanUrl}#eventlog` : null}
                    goesTo="the JobVerified event that emitted it"
                    why="No transaction was sent for this run."
                  />
                ) : (
                  "—"
                )}
              </Field>
              <Field label="An event">
                {report.verified ? "JobVerified(intentHash, outputHash)" : `JobRejected(${report.codeName})`}
              </Field>
              <Field label="A counter moved">
                agent {report.discoveredAgentId ?? "—"} ·{" "}
                {report.verified ? "verifiedDeliveries +1" : "rejectedAttempts +1"}
              </Field>
            </div>

            <p className="mt-4 font-body text-xs font-light leading-relaxed text-muted-foreground">
              No brief. No data. No analysis. Not even a price the observer can attribute — and on the
              Base run the recipient is a fresh stealth address, so the payment does not name Bob either.
            </p>
          </div>
        </div>
      )}

      {report ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {report.basescanUrl ? <ProofLink href={report.basescanUrl}>see it on Basescan ↗</ProofLink> : null}
          <span className="font-body text-xs font-light text-muted-foreground">
            This is confidentiality of content. An observer still learns that{" "}
            <em>some</em> address used the verifier at a given block — and on the Hedera run there is no
            stealth address at all; that run buys autonomy, not privacy.
          </span>
        </div>
      ) : null}
    </Panel>
  );
}
