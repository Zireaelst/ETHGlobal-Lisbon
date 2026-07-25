// timeline.ts — job lifecycle commitments (BUILD-PLAN P4-D).
//
// Five stages, each written to an HCS topic with Hedera's consensus timestamp.
// ONLY COMMITMENTS go to the topic: never the brief, the data or the output. What is hidden
// is WHAT the job was; what is not hidden is THAT the job happened. The timeline is
// deliberately a transparency layer.
//
// There is NO Hedera SDK in this file — only types and validation. The reason is
// architectural: `@ca/bob-binding` (the enclave, measured by imageHash) depends on
// `@ca/shared`; putting the Hedera SDK here would needlessly bloat the enclave image. The
// read/write work lives in `@ca/payment/src/hcs-timeline.ts`.

import { z } from 'zod';

export const TIMELINE_STAGES = [
  '402_ISSUED',
  'INTENT_COMMIT',
  'ENCLAVE_INVOKED',
  'OUTPUT_COMMIT',
  'SETTLED',
] as const;

export type TimelineStage = (typeof TIMELINE_STAGES)[number];

const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x + 64 hex digits');

/** Who wrote the commitment — so the record stays honest about whose claim it is. */
export const TimelineAuthorSchema = z.enum(['client', 'agent']);

const base = {
  v: z.literal(1),
  intentHash: Bytes32,
  by: TimelineAuthorSchema,
};

export const TimelineEventSchema = z.discriminatedUnion('stage', [
  z.object({
    ...base,
    stage: z.literal('402_ISSUED'),
    price: z.string().regex(/^\d+$/),
    currency: z.string().min(1),
    rail: z.string().min(1),
  }),
  z.object({
    ...base,
    stage: z.literal('INTENT_COMMIT'),
    client: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    agentId: z.string().regex(/^\d+$/),
    deadline: z.string().regex(/^\d+$/),
  }),
  z.object({
    ...base,
    stage: z.literal('ENCLAVE_INVOKED'),
    agentId: z.string().regex(/^\d+$/),
    /**
     * The hash of the measured enclave image. `null` until a real Tapp is connected —
     * NEVER FABRICATED. The `attestation` field states plainly what we have.
     */
    imageHash: Bytes32.nullable(),
    attestation: z.enum(['none', 'tee-attested']),
    /** The key that signed the body — the thing we ACTUALLY have. */
    bindingSigner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
  z.object({
    ...base,
    stage: z.literal('OUTPUT_COMMIT'),
    outputHash: Bytes32,
    match: z.boolean(),
    /** 0G TEE signature status — false when absent, never silently true. */
    ogVerified: z.boolean(),
    computeProvider: z.enum(['none', '0g-sealed-inference', 'fixture-replay']),
  }),
  z.object({
    ...base,
    stage: z.literal('SETTLED'),
    rail: z.string().min(1),
    txId: z.string().min(1),
    /** The JobVerified transaction that released the payment — the anchor of the ordering proof. */
    jobVerifiedTx: z.string().min(1),
  }),
]);

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/** A record read back from the mirror node, with consensus information attached. */
export interface RecordedTimelineEvent {
  event: TimelineEvent;
  sequenceNumber: number;
  consensusTimestamp: string;
}

/**
 * Verify that a commitment leaks no plaintext.
 *
 * The gate uses this, but it is also called on the production path: an event that
 * accidentally includes the brief or the output throws HERE, before it reaches the topic.
 */
export function assertNoPlaintext(event: TimelineEvent, secrets: string[]): void {
  const serialized = JSON.stringify(event);
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    // Fragments of long texts are leaks too; scan in 16-character windows.
    for (let i = 0; i + 16 <= secret.length; i += 16) {
      if (serialized.includes(secret.slice(i, i + 16))) {
        throw new Error(
          `timeline: the ${event.stage} event leaks plaintext ("${secret.slice(i, i + 16)}") — ` +
            'only commitments go to the topic',
        );
      }
    }
    if (serialized.includes(secret)) {
      throw new Error(`timeline: the ${event.stage} event leaks plaintext`);
    }
  }
}

/** The expected logical order of the stages. */
export function stageOrder(stage: TimelineStage): number {
  return TIMELINE_STAGES.indexOf(stage);
}
