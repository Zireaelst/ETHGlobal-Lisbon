// reasoning-llm.ts — the decision logic every LLM brain shares, independent of transport.
//
// `claude-local` and `0g-reasoning` differ ONLY in how a prompt string becomes a reply string.
// Everything that makes a decision safe — the re-checks in `reasoning.ts`'s wall 3 — lives
// here and exactly once. Duplicating a guard across backends is how one of the copies quietly
// stops matching the other; a brain swap must not be able to change what a decision is allowed
// to do.

import {
  HireAnswerSchema,
  PriceAnswerSchema,
  ResultAnswerSchema,
  hirePrompt,
  parseDecision,
  pricePrompt,
  resultPrompt,
} from './reasoning-prompts.js';
import type {
  HireDecision,
  HireInput,
  PriceDecision,
  PriceInput,
  ReasoningBackend,
  ReasoningProvider,
  ResultDecision,
  ResultInput,
} from './reasoning.js';

/** Turn a prompt into a raw reply. The only thing a transport has to implement. */
export type AskFn = (prompt: string, what: string) => Promise<string>;

export interface LlmReasoningOptions {
  provider: ReasoningProvider;
  ask: AskFn;
  log?: (line: string) => void;
}

export function createLlmReasoningBackend(options: LlmReasoningOptions): ReasoningBackend {
  const { provider, ask } = options;
  const log = options.log ?? (() => {});

  return {
    provider,

    async chooseAgent(input: HireInput): Promise<HireDecision> {
      const started = Date.now();
      if (input.candidates.length === 0) throw new Error('chooseAgent: the candidate list is empty');
      const answer = parseDecision(await ask(hirePrompt(input), 'chooseAgent'), HireAnswerSchema, 'chooseAgent');

      // WALL 3 — the chosen id must be one that was actually offered. A hallucinated agentId,
      // or one an instruction embedded in a candidate's own on-chain metadata talked the model
      // into naming, dies here: before anything is encrypted to that counterparty.
      const picked = input.candidates.find((c) => c.agentId === answer.agentId);
      if (!picked) throw new Error(`chooseAgent: "${answer.agentId}" was not among the candidates offered`);

      log(`[reasoning] hire agent ${picked.agentId}: ${answer.rationale}`);
      return { provider, agentId: picked.agentId, rationale: answer.rationale, latencyMs: Date.now() - started };
    },

    async approvePrice(input: PriceInput): Promise<PriceDecision> {
      const started = Date.now();
      const answer = parseDecision(await ask(pricePrompt(input), 'approvePrice'), PriceAnswerSchema, 'approvePrice');

      // WALL 3 — the ceiling is enforced in code, never in the prompt. The brain can only be
      // MORE conservative than the budget: a yes above the ceiling becomes a no, so no wording
      // in a counterparty's quote can talk the agent into overpaying.
      const within = BigInt(input.amount) <= BigInt(input.maxAmount);
      const approve = answer.approve && within;
      const rationale =
        answer.approve && !within
          ? `wanted to accept, but ${input.amount} ${input.asset} is over the hard ceiling of ${input.maxAmount}`
          : answer.rationale;

      log(`[reasoning] ${approve ? 'authorise' : 'decline'} the price: ${rationale}`);
      return { provider, approve, rationale, latencyMs: Date.now() - started };
    },

    async reviewResult(input: ResultInput): Promise<ResultDecision> {
      const started = Date.now();
      const answer = parseDecision(await ask(resultPrompt(input), 'reviewResult'), ResultAnswerSchema, 'reviewResult');

      // WALL 3 — verification outranks judgement in ONE direction. The brain may reject work
      // the cryptography accepted (it is entitled to find the analysis useless); it can never
      // accept work whose commitment did not match.
      const accept = answer.accept && input.verification.match;
      const rationale =
        answer.accept && !input.verification.match
          ? 'the prose reads well, but the commitment did not match — this is not the job that was ordered'
          : answer.rationale;

      log(`[reasoning] ${accept ? 'accept' : 'reject'} the result: ${rationale}`);
      return { provider, accept, rationale, latencyMs: Date.now() - started };
    },
  };
}
