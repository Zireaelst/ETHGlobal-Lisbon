"use client";

import { useEffect, useState } from "react";
import { Panel, Chip, ProofLink } from "./Panel";
import { short, type DiscoverySnapshot } from "@/lib/run-types";

/**
 * The registry Alice actually shops in. Not a table of ours — the same subgraph query
 * `pickBestAgent` runs, rendered.
 *
 * The claim being demonstrated: reputation with no contract of its own, no review UI and nothing
 * a user can type. `verifiedDeliveries` can only be moved by a JobVerified event from the
 * Verifier, and `rejectedAttempts` only by a JobRejected. So a fraud attempt in the panel below
 * lands here, permanently, in the number that decides ranking.
 *
 * The honest boundary is on screen, not just in the README: this is expensive to inflate, not
 * impossible, and it is not Sybil-proof (CLAUDE.md §11).
 */
export function DiscoveryPanel({ initial }: { initial: DiscoverySnapshot | null }) {
  const [data, setData] = useState<DiscoverySnapshot | null>(initial);
  const [error, setError] = useState<string | null>(null);

  // Re-poll so a rejection produced by the fraud panel shows up in the ranking while the judge
  // is still looking at it. The subgraph lags the chain by a few blocks; that lag is displayed
  // rather than hidden, which is why `indexedBlock` is on screen.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/discovery", { cache: "no-store" });
        const body = (await res.json()) as DiscoverySnapshot & { error?: string };
        if (body.error) setError(body.error);
        else {
          setData(body);
          setError(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Panel
      eyebrow="The Graph · discovery"
      title="How Alice finds anyone at all"
      subtitle="Alice is given no address. She queries the index by skill and ranks by deliveries a contract confirmed were genuinely the job the client ordered."
      actions={
        data ? (
          <>
            <Chip tone="cool">block {data.indexedBlock.toLocaleString()}</Chip>
            {data.hasIndexingErrors ? <Chip tone="alert">indexing errors</Chip> : null}
          </>
        ) : null
      }
    >
      {error ? (
        <p className="rounded-md border border-alert/40 px-3 py-2 font-body text-sm font-light text-alert">
          The subgraph could not be read: {error}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="mb-5 flex flex-wrap gap-x-8 gap-y-2">
            <Stat label="agents indexed" value={data.totals.agentCount} />
            <Stat label="verified deliveries" value={data.totals.verifiedJobs} />
            <Stat label="rejected attempts" value={data.totals.rejectedJobs} alert />
          </div>

          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[540px] border-collapse">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-1 py-2 font-normal">agent</th>
                  <th className="px-1 py-2 font-normal">skills</th>
                  <th className="px-1 py-2 text-right font-normal">verified</th>
                  <th className="px-1 py-2 text-right font-normal">rejected</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((agent, i) => (
                  <tr key={agent.agentId} className="border-b border-border/50 last:border-0">
                    <td className="px-1 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-foreground">{agent.agentId}</span>
                        {i === 0 ? <Chip tone="good">top ranked</Chip> : null}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {short(agent.owner, 8, 6)}
                      </div>
                    </td>
                    <td className="px-1 py-3 font-body text-sm font-light text-muted-foreground">
                      {agent.skills.join(", ") || "—"}
                    </td>
                    <td className="px-1 py-3 text-right font-mono text-sm text-warm">
                      {agent.verifiedDeliveries}
                    </td>
                    <td className="px-1 py-3 text-right font-mono text-sm text-alert">
                      {agent.rejectedAttempts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 font-body text-xs font-light leading-relaxed text-muted-foreground">
            Neither column can be written to directly — only the Verifier&apos;s events move them. That
            makes this reputation <em>expensive</em> to inflate, which is a different and smaller claim
            than Sybil-proof. We do not make the larger one.{" "}
            <ProofLink href={data.subgraphUrl}>Query the endpoint yourself ↗</ProofLink>
          </p>
        </>
      ) : !error ? (
        <p className="font-body text-sm font-light text-muted-foreground">Reading the index…</p>
      ) : null}
    </Panel>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div>
      <div className={`font-display text-2xl ${alert ? "text-alert" : "text-foreground"}`}>{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
    </div>
  );
}
