// reasoning-select.ts — decide from the environment which brain the agents use.
//
// The sibling of `compute-select.ts`, on purpose: same shape, same rule that every mode names
// itself honestly, and the same refusal to silently substitute one thing for another.
//
//   REASONING_BACKEND=claude → 'claude-local'   Claude Code headless, subscription auth
//   REASONING_BACKEND=0g     → '0g-reasoning'   decisions through 0G Compute (spends faucet)
//   unset or =policy         → 'policy'         deterministic ranking, no model at all
//
// WHY THE DEFAULT IS `policy` AND NOT `claude`: the gates are the reason. A test suite whose
// outcome depends on a model's mood, a network round trip and a subscription's rate limit is
// not a test suite. The gates run deterministically; the demo opts in.
//
// Every LLM backend is wrapped in `withPolicyFallback`, so a brain that is unavailable
// downgrades the DEMO'S NARRATION rather than the demo. The fallback announces itself
// (`fellBackFrom`) all the way into the dashboard — a fallback that hides itself is a lie
// about who decided.

import type { ComputeBackend } from './compute.js';
import {
  createPolicyReasoningBackend,
  withPolicyFallback,
  type ReasoningBackend,
} from './reasoning.js';

export interface ReasoningSelectionEnv {
  REASONING_BACKEND?: string;
  /** Model alias for the local brain (`sonnet` by default). */
  CLAUDE_AGENT_MODEL?: string;
}

export interface ReasoningSelectionOptions {
  /**
   * Required only by the `0g` backend. Passing the compute backend in rather than building one
   * keeps the faucet spend visible at the call site — nothing here quietly opens a second
   * billing channel behind the caller's back.
   */
  compute?: ComputeBackend;
  log?: (line: string) => void;
}

export async function selectReasoningBackend(
  env: ReasoningSelectionEnv,
  options: ReasoningSelectionOptions = {},
): Promise<{ backend: ReasoningBackend; reason: string }> {
  const choice = (env.REASONING_BACKEND ?? 'policy').trim().toLowerCase();
  const log = options.log;

  if (choice === 'claude' || choice === 'claude-local') {
    const { createClaudeReasoningBackend } = await import('./reasoning-claude.js');
    return {
      backend: withPolicyFallback(
        createClaudeReasoningBackend({ model: env.CLAUDE_AGENT_MODEL, log }),
        log,
      ),
      reason: 'REASONING_BACKEND=claude → the agents decide via local Claude (subscription auth)',
    };
  }

  if (choice === '0g' || choice === '0g-reasoning') {
    if (!options.compute) {
      throw new Error(
        'REASONING_BACKEND=0g needs a compute backend — pass `compute` to selectReasoningBackend',
      );
    }
    const { createZeroGReasoningBackend } = await import('./reasoning-0g.js');
    return {
      backend: withPolicyFallback(createZeroGReasoningBackend({ compute: options.compute, log }), log),
      reason: 'REASONING_BACKEND=0g → the agents decide via 0G Compute (spends the faucet budget)',
    };
  }

  if (choice !== 'policy') {
    throw new Error(
      `unknown REASONING_BACKEND "${choice}" — expected one of: claude, 0g, policy. ` +
        'Refusing to guess: which brain decided is something we report, not something we assume.',
    );
  }

  return {
    backend: createPolicyReasoningBackend(),
    reason: 'REASONING_BACKEND unset/policy → deterministic ranking, no model in the loop',
  };
}
