// compute.ts — the boundary that separates WHERE the model runs from the binding logic.
//
// Why a separate boundary: `runBinding` recomputes the job's commitment and signs the body;
// whether the model ran in a 0G TEE, from a fixture, or not at all is none of its business.
// Thanks to this boundary, when the real 0G backend arrives `runBinding`, the body encoding,
// `Verifier.sol`, the subgraph and the gates DO NOT CHANGE — only which backend bob-agent
// selects changes.
//
// HONESTY RULE (BUILD-PLAN P3-B): `ogVerified` may only be true once WE have recovered the
// signature ourselves and matched it against the `teeSignerAddress` the broker reports.
// When there is no signature the field stays `undefined` — a fake signature is NEVER
// produced. The `provider` field is also carried all the way to the UI so that "is there a
// 0G attestation?" is displayed rather than inferred.

import type { Constraints } from './intent.js';

export interface ComputeRequest {
  brief: string;
  data: string;
  constraints: Constraints;
  /**
   * The client's order commitment (`intentHash`) — LEVEL 0 BINDING.
   *
   * When supplied it is placed at the top of the prompt and the model is asked to reproduce
   * it VERBATIM in its output. The body the 0G TEE signs then covers this value too:
   *     TEE signature → response body → output → intentHash → Alice's EIP-712 signature
   * Bob cannot produce that chain on his own machine; the first link comes from 0G hardware.
   *
   * WHY THE CLAIMED HASH: both the contract and Alice look at this value. The recomputed
   * hash is already reported through the `match` flag in the body, so carrying it again adds
   * no information.
   *
   * LIMIT: this does NOT mean "the hash really belongs to that brief+data". The model
   * repeats it, it does not validate it. That check still runs in our unattested code.
   */
  commitment?: string;
}

/** Who produced the output — an honesty label carried all the way to the user interface. */
export type ComputeProvider = 'none' | '0g-sealed-inference' | 'fixture-replay';

export interface ComputeResult {
  /** The text the model produced. */
  output: string;
  /**
   * The 0G TEE's EIP-191 signature. Undefined when absent — never fabricated.
   *
   * WHAT IT COVERS (MEASURED in P0-B; CLAUDE.md §3.1 was corrected accordingly): the
   * signature does NOT cover the output text but this tuple:
   *     "<h1>:<sha256(raw response body)>:<ProviderType>:<ProviderIdentity>:<h3>"
   * So the output is within the signature's scope as the FINGERPRINT of the body containing
   * it. The tamper guarantee is the same; the sentence you may say is different.
   * `chatId` establishes the output↔request link in 0G's own ledger.
   */
  ogSig?: string;
  /** The address recovered from the signature — compared against the broker's `teeSignerAddress`. */
  ogSigner?: string;
  /** Was the signature verified INSIDE THE ENCLAVE? False when it could not be; never silently true. */
  ogVerified: boolean;
  provider: ComputeProvider;
  /**
   * Was a `commitment` placed in the prompt — i.e. does this output have Level 0 binding?
   * Whether the output REALLY carries the commitment is checked by the enclave
   * (`runBinding`) itself, not by the backend, so it does not depend on the backend's honesty.
   */
  commitmentRequested?: boolean;
  /** The request id in 0G's ledger (for `processResponse`). */
  chatId?: string;
  /** Measurement for the P0-G latency budget. */
  latencyMs: number;
}

export interface ComputeBackend {
  readonly provider: ComputeProvider;
  run(request: ComputeRequest): Promise<ComputeResult>;
}

/**
 * The backend that works without 0G access.
 *
 * It PRODUCES no real analysis and CLAIMS no attestation: `ogVerified: false`,
 * `provider: 'none'`. The system knows how to say "there is no 0G signature here" — it
 * reports the absence correctly rather than fabricating a TEE signature.
 *
 * The real backend (`createZeroGComputeBackend`) implements this same interface, so callers
 * needed no changes when it arrived.
 */
export function createNoComputeBackend(): ComputeBackend {
  return {
    provider: 'none',
    async run(request: ComputeRequest): Promise<ComputeResult> {
      const started = Date.now();
      const output =
        `[compute: none] Received a ${request.brief.length}-character brief and ` +
        `${request.data.length} characters of data; NO real inference was run with model ` +
        `"${request.constraints.model}". Once 0G Sealed Inference is connected, real analysis ` +
        `and a TEE signature replace this text.`;
      return {
        output,
        ogVerified: false,
        provider: 'none',
        latencyMs: Date.now() - started,
      };
    },
  };
}

/** Human-readable summary — for gate output and the demo panel. */
export function describeCompute(result: Pick<ComputeResult, 'provider' | 'ogVerified'>): string {
  switch (result.provider) {
    case '0g-sealed-inference':
      return result.ogVerified
        ? '0G Sealed Inference · TEE signature verified'
        : '0G Sealed Inference · signature NOT VERIFIED';
    case 'fixture-replay':
      return 'recorded 0G response (fixture replay) · not a live call';
    case 'none':
      return '0G not connected · NO real inference and NO TEE signature';
  }
}
