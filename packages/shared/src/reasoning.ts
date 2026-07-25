// reasoning.ts — the boundary that separates WHO DECIDES from what is verified.
//
// This is the agents' brain. It mirrors `compute.ts` deliberately: the same interface +
// selection + honest-labelling discipline, because the same question applies to both — "who
// produced this, and are we allowed to say so?". `ReasoningProvider` travels all the way to
// the dashboard, exactly like `ComputeProvider`.
//
// WHAT IT IS FOR: making Alice and Bob autonomous. Alice picks who to hire from the subgraph's
// candidates, decides whether the quoted price is worth paying, and judges whether the returned
// work answered her brief. Those are the decisions a human client would make, and an agent that
// cannot make them is a script, not an agent.
//
// WHAT IT IS **NOT** FOR — three walls, and they are the thesis (CLAUDE.md §2, §9, §11):
//
//   1. THE MODEL BEING SOLD IS NOT THIS MODEL. The analysis Alice buys runs in 0G Sealed
//      Inference (`compute.ts`), which is where the TEE signature and the `intentHash` echo
//      come from. Reasoning NEVER produces the deliverable. Swapping this backend cannot
//      change a single byte of what the enclave signed.
//
//   2. THE BRAIN NEVER SEES A PRIVATE KEY. Decisions come back as small structured verdicts;
//      signing, paying and settling stay in deterministic code. This is CLAUDE.md §9's
//      delegated-signing rule enforced by construction rather than by discipline.
//
//   3. THE BRAIN CANNOT WIDEN A GUARANTEE, ONLY NARROW ONE. Every decision below is
//      re-checked deterministically by the caller, and the check is always a tightening:
//      `chooseAgent` must name a candidate that was actually offered; `approvePrice` is ANDed
//      with a hard budget ceiling the model never sees the other side of. A confused — or
//      prompt-injected — model can refuse to trade. It cannot overpay, cannot invent a
//      counterparty, and cannot make an invalid job verify. `match`, the signature checks and
//      the contract's verdict do not consult this file at all.

/** Who made the decision — an honesty label carried to the user interface. */
export type ReasoningProvider = 'policy' | 'claude-local' | '0g-reasoning';

/** One candidate from the subgraph, flattened to what a decision actually needs. */
export interface AgentCandidate {
  agentId: string;
  skills: string[];
  verifiedDeliveries: number;
  rejectedAttempts: number;
  endpoint: string | null;
}

/** Common to every decision — so the UI can always say who decided, and how fast. */
export interface DecisionMeta {
  provider: ReasoningProvider;
  /** One sentence, in the deciding agent's own words. Shown verbatim in the dashboard. */
  rationale: string;
  latencyMs: number;
  /**
   * Set when the backend failed and the deterministic policy answered instead. The dashboard
   * shows this — a fallback that hides itself is a lie about who decided.
   */
  fellBackFrom?: ReasoningProvider;
}

export interface HireDecision extends DecisionMeta {
  agentId: string;
}

export interface PriceDecision extends DecisionMeta {
  approve: boolean;
}

export interface ResultDecision extends DecisionMeta {
  accept: boolean;
}

export interface HireInput {
  /** What Alice wants done, in one line — the skill plus her own framing. */
  need: string;
  candidates: AgentCandidate[];
}

export interface PriceInput {
  need: string;
  /** The quoted amount in the asset's smallest unit (matching the 402 response). */
  amount: string;
  asset: string;
  /** The ceiling Alice will not cross. Enforced in code; see wall 3 above. */
  maxAmount: string;
  agentId: string;
  verifiedDeliveries: number;
}

export interface ResultInput {
  brief: string;
  output: string;
  /**
   * The verification outcome, ALREADY DECIDED elsewhere. Passed in as context so the agent's
   * commentary is informed — never so that it can revise it.
   */
  verification: { match: boolean; ogVerified: boolean; provider: string };
}

export interface ReasoningBackend {
  readonly provider: ReasoningProvider;
  chooseAgent(input: HireInput): Promise<HireDecision>;
  approvePrice(input: PriceInput): Promise<PriceDecision>;
  reviewResult(input: ResultInput): Promise<ResultDecision>;
}

/**
 * Rank by verified deliveries, then by the fewest rejected attempts. Identical to
 * `pickBestAgent`'s ordering, so switching the brain off changes nothing about how the demo
 * behaves — it only changes who chose.
 */
export function rankCandidates(candidates: AgentCandidate[]): AgentCandidate[] {
  return [...candidates].sort(
    (a, b) => b.verifiedDeliveries - a.verifiedDeliveries || a.rejectedAttempts - b.rejectedAttempts,
  );
}

/**
 * The deterministic backend. Always available, needs no network and no quota, and it is what
 * the gates run against so the test suite stays hermetic and reproducible.
 */
export function createPolicyReasoningBackend(): ReasoningBackend {
  const meta = (rationale: string, started: number): DecisionMeta => ({
    provider: 'policy',
    rationale,
    latencyMs: Date.now() - started,
  });

  return {
    provider: 'policy',

    async chooseAgent(input: HireInput): Promise<HireDecision> {
      const started = Date.now();
      const best = rankCandidates(input.candidates)[0];
      if (!best) throw new Error('chooseAgent: the candidate list is empty');
      return {
        ...meta(
          `highest verified-delivery count (${best.verifiedDeliveries}) with ` +
            `${best.rejectedAttempts} rejected attempts`,
          started,
        ),
        agentId: best.agentId,
      };
    },

    async approvePrice(input: PriceInput): Promise<PriceDecision> {
      const started = Date.now();
      const within = BigInt(input.amount) <= BigInt(input.maxAmount);
      return {
        ...meta(
          within
            ? `${input.amount} ${input.asset} is within the ${input.maxAmount} ceiling`
            : `${input.amount} ${input.asset} exceeds the ${input.maxAmount} ceiling`,
          started,
        ),
        approve: within,
      };
    },

    async reviewResult(input: ResultInput): Promise<ResultDecision> {
      const started = Date.now();
      // The policy brain has no opinion on prose; it repeats what verification established.
      return {
        ...meta(
          input.verification.match
            ? 'the commitment matched, so the delivered work is the work that was ordered'
            : 'the commitment did not match — this is not the job that was ordered',
          started,
        ),
        accept: input.verification.match,
      };
    },
  };
}

/**
 * Wrap a backend so that any failure degrades to the deterministic policy INSTEAD OF killing
 * the run — with `fellBackFrom` set, so the dashboard can say what actually happened.
 *
 * Why this exists: the demo runs on a laptop in front of judges. A rate limit, an expired
 * login or a dropped network must cost us a nicer rationale, never the run.
 */
export function withPolicyFallback(
  backend: ReasoningBackend,
  log: (line: string) => void = () => {},
): ReasoningBackend {
  const policy = createPolicyReasoningBackend();

  const guard = async <T extends DecisionMeta>(
    what: string,
    attempt: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await attempt();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      log(`[reasoning] ${backend.provider} failed on ${what} (${why}) — falling back to policy`);
      const result = await fallback();
      return { ...result, fellBackFrom: backend.provider };
    }
  };

  return {
    provider: backend.provider,
    chooseAgent: (input) =>
      guard('chooseAgent', () => backend.chooseAgent(input), () => policy.chooseAgent(input)),
    approvePrice: (input) =>
      guard('approvePrice', () => backend.approvePrice(input), () => policy.approvePrice(input)),
    reviewResult: (input) =>
      guard('reviewResult', () => backend.reviewResult(input), () => policy.reviewResult(input)),
  };
}

/** Human-readable summary — for gate output and the dashboard's "who decided" line. */
export function describeReasoning(provider: ReasoningProvider): string {
  switch (provider) {
    case 'claude-local':
      return 'Claude running locally (Claude Code, subscription auth) — no key ever enters the prompt';
    case '0g-reasoning':
      return '0G Compute — the same network that runs the work also runs the agents’ decisions';
    case 'policy':
      return 'deterministic policy — ranked by verified deliveries, no model involved';
  }
}
