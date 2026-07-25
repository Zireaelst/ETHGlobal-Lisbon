// reasoning-0g.ts — the agents' brain, running on 0G Compute.
//
// Transport only; the decisions and their guards live in `reasoning-llm.ts`.
//
// Why this backend exists at all, given `claude-local` is the one we demo: the local brain
// needs a laptop that is switched on and logged in. This one needs neither, so a publicly
// hosted dashboard can still show agents that genuinely decide, and a dead subscription or a
// rate limit during judging costs us nothing. It also lets us say something true and neat —
// the same network that runs the work can run the agents' reasoning.
//
// IT SPENDS THE SAME BUDGET AS THE HERO. Decisions go through the ordinary `ComputeBackend`,
// so every call eats into the 0.1 OG/day faucet allowance that the Sealed Inference demo needs
// (CLAUDE.md §8 P0-C). If that budget is tight, `policy` is the backend to fall back to —
// never the other way around. Deliverables come first.
//
// NO BINDING IS CLAIMED HERE. `commitment` is deliberately not passed: a decision is not a
// deliverable, nothing about it is attested, and it must never be confused with the enclave
// output that carries the intentHash echo.

import type { ComputeBackend } from './compute.js';
import { createLlmReasoningBackend } from './reasoning-llm.js';
import { REASONING_SYSTEM_PROMPT } from './reasoning-prompts.js';
import type { ReasoningBackend } from './reasoning.js';

export interface ZeroGReasoningOptions {
  /** The same compute boundary the work uses — the transport is shared, the meaning is not. */
  compute: ComputeBackend;
  model?: string;
  log?: (line: string) => void;
}

export function createZeroGReasoningBackend(options: ZeroGReasoningOptions): ReasoningBackend {
  const model = options.model ?? 'qwen2.5-omni-7b';

  return createLlmReasoningBackend({
    provider: '0g-reasoning',
    log: options.log,
    async ask(prompt: string, what: string): Promise<string> {
      const result = await options.compute.run({
        // The system prompt rides along in the brief: `ComputeRequest` has no system-role slot,
        // because the thing it was built for — the deliverable — does not want one.
        brief: `${REASONING_SYSTEM_PROMPT}\n\n${prompt}`,
        data: '',
        // Short and near-deterministic: this is a judgement call, not prose. A low token cap
        // is also the cheapest protection there is for the shared faucet budget.
        constraints: { model, maxTokens: 256, temperature: 0 },
      });
      if (!result.output) throw new Error(`${what}: 0G returned an empty reply`);
      return result.output;
    },
  });
}
