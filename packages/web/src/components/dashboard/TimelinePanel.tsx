"use client";

import { useEffect, useState } from "react";
import { Panel, Chip, ProofLink } from "./Panel";
import { short, type RunView, type TimelineSnapshot } from "@/lib/run-types";

/**
 * The off-chain timeline, timestamped by Hedera consensus.
 *
 * The times on screen are `consensus_timestamp` read back from the public mirror node — the
 * network's clock, not ours. A timeline whose times came from the machine that wrote it would
 * prove nothing, which is the whole reason this reads back rather than displaying what we sent.
 *
 * Only COMMITMENTS are on the topic: stage names, hashes, flags. The brief, the data and the
 * output never go near it, and @ca/payment's hcs-timeline scans outgoing messages for those
 * secrets before they reach the network.
 */

const STAGE_BLURB: Record<string, string> = {
  "402_ISSUED": "Bob quoted a price and refused to work until it was authorised.",
  INTENT_COMMIT: "Alice committed to exactly this job, signed EIP-712.",
  ENCLAVE_INVOKED: "The job entered the enclave.",
  OUTPUT_COMMIT: "The enclave committed to what came out, and to whether it matched.",
  SETTLED: "Payment released — only ever written after JobVerified.",
};

export function TimelinePanel({ run }: { run: RunView | null }) {
  const [data, setData] = useState<TimelineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intentHash = run?.report.signedIntentHash;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const url = intentHash ? `/api/timeline?intentHash=${intentHash}` : "/api/timeline";
        const res = await fetch(url, { cache: "no-store" });
        const body = (await res.json()) as TimelineSnapshot & { error?: string };
        if (cancelled) return;
        if (body.error) setError(body.error);
        else {
          setData(body);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    // The mirror node trails consensus by a few seconds, so a run's messages appear shortly
    // after the run itself finishes. Polling briefly is honest; pretending they are already
    // there would not be.
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intentHash]);

  const messages = data?.messages ?? [];

  return (
    <Panel
      eyebrow="Hedera · the timeline"
      title="When each step actually happened"
      tint="cool"
      subtitle="Every stage of the job, stamped by Hedera consensus and read back from the public mirror node — not from our own clock."
      actions={
        data ? (
          <>
            <Chip tone="cool">topic {data.topicId}</Chip>
            {intentHash ? <Chip tone="neutral">this job</Chip> : <Chip tone="neutral">latest</Chip>}
          </>
        ) : null
      }
    >
      {error ? (
        <p className="rounded-md border border-alert/40 px-3 py-2 font-body text-sm font-light text-alert">
          The mirror node could not be read: {error}
        </p>
      ) : null}

      {messages.length === 0 && !error ? (
        <p className="font-body text-sm font-light text-muted-foreground">
          {intentHash
            ? "Waiting for this job's messages to reach the mirror node…"
            : "Reading the topic…"}
        </p>
      ) : null}

      <ol className="relative space-y-0">
        {messages.map((m, i) => {
          const stage = String(m.payload.stage ?? "—");
          const isLast = i === messages.length - 1;
          return (
            <li key={m.sequenceNumber} className="relative flex gap-4 pb-5 last:pb-0">
              <div className="flex flex-col items-center">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cool" />
                {!isLast ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-sm text-foreground">{stage}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {m.consensusIso.replace("T", " ").replace("Z", " UTC")}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground opacity-70">
                    seq #{m.sequenceNumber}
                  </span>
                </div>
                {STAGE_BLURB[stage] ? (
                  <p className="mt-1 font-body text-xs font-light leading-relaxed text-muted-foreground">
                    {STAGE_BLURB[stage]}
                  </p>
                ) : null}
                <div className="mt-1.5 font-mono text-[10px] text-muted-foreground opacity-80">
                  {"intentHash" in m.payload ? short(String(m.payload.intentHash), 12, 6) : null}
                  {"match" in m.payload ? ` · match=${String(m.payload.match)}` : null}
                  {"attestation" in m.payload ? ` · attestation=${String(m.payload.attestation)}` : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {data ? (
        <p className="mt-5 font-body text-xs font-light leading-relaxed text-muted-foreground">
          Commitments only — no brief, no data, no output ever reaches the topic.{" "}
          <ProofLink href={data.hashscanUrl}>HashScan ↗</ProofLink>{" "}
          <ProofLink href={data.mirrorQueryUrl}>the exact mirror-node query ↗</ProofLink>
        </p>
      ) : null}
    </Panel>
  );
}
