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

  return (
    <div className="space-y-5">
      <DiscoveryPanel initial={discovery} />
      <SpyPanel run={run} />
      <FraudPanel run={run} onRun={setRun} runnerEnabled={runnerEnabled} />
      <TimelinePanel run={run} />
      <VerifyPanel run={run} />
      <EvidencePanel evidence={evidence} />
    </div>
  );
}
