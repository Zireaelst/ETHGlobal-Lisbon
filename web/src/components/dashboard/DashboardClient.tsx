"use client";

import { useState } from "react";
import { DiscoveryPanel } from "./DiscoveryPanel";
import { SpyPanel } from "./SpyPanel";
import { FraudPanel } from "./FraudPanel";
import { TimelinePanel } from "./TimelinePanel";
import { VerifyPanel } from "./VerifyPanel";
import { EvidencePanel } from "./EvidencePanel";
import type { DiscoverySnapshot, RunView } from "@/lib/run-types";
import type { NetworkEvidence } from "@/lib/server/networks";

/**
 * Holds the one piece of state the panels share: the run currently being shown.
 *
 * Four panels read it, one produces it. Keeping it here rather than in a context is deliberate —
 * with a single value and a single writer, a context would add indirection and no safety.
 *
 * The order on screen is the order of the pitch, not the order of the architecture: find the
 * agent, see what stays private, break it, see when it happened, check it yourself — and last,
 * the receipts for every network the job touched.
 */
export function DashboardClient({
  discovery,
  evidence,
  runnerEnabled,
}: {
  discovery: DiscoverySnapshot | null;
  evidence: NetworkEvidence[];
  runnerEnabled: boolean;
}) {
  const [run, setRun] = useState<RunView | null>(null);

  // A finished run is the ONE moment the ranking below can have changed — a JobVerified or a
  // JobRejected is the only thing that moves those counters. So the discovery panel is told to
  // read again here, on the event, rather than polling on the chance of it. That is both cheaper
  // and faster: cheaper because the idle cadence can now be minutes, faster because the
  // rejection appears when it happens instead of up to a poll-interval later.
  const [refreshKey, setRefreshKey] = useState(0);
  const handleRun = (view: RunView | null) => {
    setRun(view);
    if (view) setRefreshKey((n) => n + 1);
  };

  return (
    <div className="space-y-5">
      <DiscoveryPanel initial={discovery} refreshKey={refreshKey} />
      <SpyPanel run={run} />
      <FraudPanel run={run} onRun={handleRun} runnerEnabled={runnerEnabled} />
      <TimelinePanel run={run} />
      <VerifyPanel run={run} />
      <EvidencePanel evidence={evidence} />
    </div>
  );
}
