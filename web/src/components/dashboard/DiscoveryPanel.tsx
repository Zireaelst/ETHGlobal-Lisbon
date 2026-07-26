"use client";

import { useEffect, useState } from "react";
import { Panel, Chip, ProofLink } from "./Panel";
import { Hash } from "./Hash";
import { type DiscoverySnapshot } from "@/lib/run-types";

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
/**
 * Polling schedule.
 *
 * The old one was a flat 15s `setInterval` that never varied — so a rate-limited panel kept
 * asking at exactly the rate that got it rate-limited, and a tab left open in the background
 * went on querying all day for nobody. One tab open for 12 hours was the whole daily quota.
 *
 * The idle cadence is now measured in minutes because polling is no longer how a change is
 * noticed: `refreshKey` reads immediately when a run finishes, which is the only event that can
 * move these counters. What is left is a slow heartbeat for changes made elsewhere.
 */
const BASE_MS = 120_000;
const MAX_MS = 10 * 60_000;

export function DiscoveryPanel({
  initial,
  refreshKey = 0,
}: {
  initial: DiscoverySnapshot | null;
  /** Bumped by the dashboard when a run completes; any change triggers an immediate read. */
  refreshKey?: number;
}) {
  const [data, setData] = useState<DiscoverySnapshot | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<{ ageMs: number; reason: string } | null>(null);

  // A rejection produced by the fraud panel has to show up in the ranking while the judge is
  // still looking at it. That now happens on the EVENT (`refreshKey`) rather than by polling on
  // the chance of it; the interval below is only a slow heartbeat for changes made elsewhere.
  // The subgraph lags the chain by a few blocks — that lag is displayed rather than hidden,
  // which is why `indexedBlock` is on screen, and why a run reads twice (see below).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let followUp: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let delay = BASE_MS;

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(run, delay);
    };

    const run = async () => {
      if (cancelled) return;
      // Nobody is looking. Skip the query and check again at the normal cadence — the panel
      // refreshes the moment the tab comes back, so this costs the viewer nothing and takes
      // every backgrounded tab out of the rate limit.
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }

      try {
        const res = await fetch("/api/discovery", { cache: "no-store" });
        const body = (await res.json()) as DiscoverySnapshot & {
          error?: string;
          staleMs?: number;
          staleReason?: string;
          rateLimited?: boolean;
        };

        if (res.status === 429 || body.rateLimited) {
          // Back off geometrically. This is the case the flat interval could not get out of:
          // the endpoint says "too many", so asking again in 15s is asking to be refused again.
          delay = Math.min(delay * 2, MAX_MS);
          setError(
            `the subgraph is rate limiting us — slowing to ${Math.round(delay / 1000)}s between reads`,
          );
        } else if (body.error) {
          delay = Math.min(delay * 2, MAX_MS);
          setError(body.error);
        } else {
          delay = BASE_MS;
          setData(body);
          setError(null);
        }

        // Held-over data is shown, and shown AS held over. Served with 200 alongside the reason,
        // so this branch can coexist with either of the two above.
        setStale(
          body.staleMs !== undefined
            ? { ageMs: body.staleMs, reason: body.staleReason ?? "the last read failed" }
            : null,
        );
      } catch (e) {
        delay = Math.min(delay * 2, MAX_MS);
        setError(e instanceof Error ? e.message : String(e));
      }
      schedule();
    };

    // Coming back to the tab is the one moment a fresh read is actually worth spending: reset
    // the backoff and read now, rather than making the viewer wait out a five-minute delay
    // that only grew while they were away.
    const onVisible = () => {
      if (document.hidden || cancelled) return;
      delay = BASE_MS;
      clearTimeout(timer);
      void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    if (refreshKey > 0) {
      // A run just finished. Read now — and once more a few seconds later, because the index
      // trails the chain and the first read can easily land before the event we just caused is
      // in it. Two queries per run is nothing next to the interval this replaced.
      void run();
      followUp = setTimeout(() => void run(), 8_000);
    } else {
      // First mount: the server already fetched this data for the initial paint. Reading again
      // straight away would spend a query to learn what is on screen.
      schedule();
    }

    return () => {
      cancelled = true;
      clearTimeout(followUp);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Re-armed on each run: the teardown cancels the pending heartbeat and the new pass reads
    // immediately, which is exactly the behaviour wanted when a job has just been ruled on.
  }, [refreshKey]);

  return (
    <Panel
      eyebrow="The Graph · discovery"
      title="How Alice finds anyone at all"
      subtitle="Alice is given no address. She queries the index by skill and ranks by deliveries a contract confirmed were genuinely the job the client ordered."
      actions={
        data ? (
          <>
            <Chip tone="cool">block {data.indexedBlock.toLocaleString()}</Chip>
            {/* Live and held-over must not look the same. When the last read failed we keep
                showing the previous answer rather than blanking the panel, and this chip is
                what stops that from being a quiet lie. */}
            {stale ? (
              <Chip tone="neutral" title={stale.reason}>
                held over · {Math.round(stale.ageMs / 1000)}s old
              </Chip>
            ) : null}
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
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        <Hash value={agent.owner} network="base" kind="address" lead={8} tail={6} />
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
