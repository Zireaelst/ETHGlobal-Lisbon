// Client-safe mirrors of the shapes the API returns.
//
// These deliberately DO NOT import from @ca/demo. That package boots Bob's HTTP server, signs
// with ethers and spawns the Claude CLI; a type-only import is erased at build time, but one
// careless value import later would drag the entire agent stack into the browser bundle. A
// separate declaration is the cheap way to make that mistake impossible rather than merely
// unlikely.
//
// The tradeoff is that these must be kept in step with DemoReport by hand. The route handlers
// are typed against the real thing, so a drift shows up there first.

export type FraudMode = "none" | "substitute" | "tamper" | "forge" | "selfintent";

/**
 * Which rail carries the payment. The two are NOT interchangeable and the demo lets the operator
 * pick, because they buy different things: Base hides WHO was paid (ERC-5564 stealth), Hedera
 * hides nothing and buys autonomy plus a consensus-timestamped trail (CLAUDE.md §11 — the Hedera
 * run is not the private one, and saying otherwise would be the easiest claim here to overstate).
 */
export type PaymentRail = "hedera" | "base";

export type ComputeProvider = "none" | "0g-sealed-inference" | "fixture-replay";
export type ReasoningProvider = "policy" | "claude-local" | "0g-reasoning";

export interface Decision {
  provider: ReasoningProvider;
  rationale: string;
  latencyMs: number;
  /** Set when the chosen brain failed and the deterministic policy answered instead. */
  fellBackFrom?: ReasoningProvider;
}

export interface HireDecision extends Decision {
  agentId: string;
}
export interface PriceDecision extends Decision {
  approve: boolean;
}
export interface ResultDecision extends Decision {
  accept: boolean;
}

export interface RunReport {
  fraudMode: FraudMode;
  signedIntentHash: string;
  bodyIntentHash: string;
  match: boolean;
  clientSigOk: boolean;
  bindingSigOk: boolean;
  computeProvider: ComputeProvider;
  ogVerified: boolean;
  reasoningProvider: ReasoningProvider;
  decisions?: {
    hire?: HireDecision;
    price?: PriceDecision;
    result?: ResultDecision;
  };
  output: string;
  code: number;
  codeName: string;
  verified: boolean;
  txHash?: string;
  blockNumber?: number;
  basescanUrl?: string;
  totalMs: number;
  stageMs: Record<string, number>;
  discoveredAgentId?: string;
  payment?: {
    rail: string;
    quoted: boolean;
    authorized: boolean;
    settled: boolean;
    skippedReason?: string;
    txRef?: string;
    explorerUrl?: string;
    /** Who the money actually reached, and who the agent is publicly registered as. */
    paidTo?: string;
    agentIdentity?: string;
  };
  timeline?: {
    topicId: string;
    hashscanUrl: string;
    stages: string[];
  };
}

/** A run the UI is showing, and — crucially — whether it happened just now. */
export interface RunView {
  report: RunReport;
  /** false = a recording of a real past run. Never a mock; always labelled. */
  live: boolean;
  recordedAt?: string;
}

export interface DashboardAgent {
  agentId: string;
  owner: string;
  skills: string[];
  endpoint: string | null;
  verifiedDeliveries: number;
  rejectedAttempts: number;
  registeredBlock: string;
}

export interface DashboardJob {
  intentHash: string;
  agentId: string;
  client: string;
  outputHash: string | null;
  status: string;
  rejectionCode: string | null;
  price: string;
  timestamp: string;
  block: string;
  txHash: string;
}

export interface DiscoverySnapshot {
  agents: DashboardAgent[];
  jobs: DashboardJob[];
  totals: { agentCount: number; verifiedJobs: number; rejectedJobs: number };
  indexedBlock: number;
  hasIndexingErrors: boolean;
  subgraphUrl: string;
}

export interface TimelineMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  consensusIso: string;
  payload: Record<string, unknown>;
  raw?: string;
  messageUrl: string;
}

export interface TimelineSnapshot {
  topicId: string;
  hashscanUrl: string;
  mirrorQueryUrl: string;
  messages: TimelineMessage[];
}

export const BASESCAN = "https://sepolia.basescan.org";

/**
 * Shorten a hash for display without ever implying the full value is something else.
 *
 * The `tail <= 0` branch is a bug guard, not defensive padding: `slice(-0)` returns the WHOLE
 * string, because -0 === 0 in JavaScript. A caller asking for "head only" therefore got the
 * truncated head followed by the entire untruncated value — which is exactly what the evidence
 * panel rendered for every long URL until this was fixed.
 */
export function short(hash: string | null | undefined, lead = 10, tail = 6): string {
  if (!hash) return "—";
  if (hash.length <= lead + tail + 1) return hash;
  return tail <= 0 ? `${hash.slice(0, lead)}…` : `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}
