// schema.ts — zod schemas for the wire formats (BUILD-PLAN §2.3).
//
// Purpose: kill SILENT disagreement between the two agents. A malformed payload is
// rejected with a 400 instead of crashing with a 500 (P1-C gate criterion).
//
// bigint rule: JSON cannot carry bigint. On the wire `price`, `deadline` and `nonce` are
// DECIMAL STRINGS; the `toWire`/`fromWire` conversion happens in exactly one place. Using
// bigint in one spot and number in another is the sneakiest class of bug that silently
// changes a hash.

import { z } from 'zod';
import type { Constraints, Intent } from './intent.js';

const hex = (bytes: number) =>
  z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`), `must be 0x + ${bytes * 2} hex digits`);

export const Bytes32Schema = hex(32);
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be an EVM address');
export const SignatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'must be a 65-byte signature (r‖s‖v)');
/** Non-negative integer as a decimal string. */
export const UintStringSchema = z.string().regex(/^\d+$/, 'must be a decimal string (JSON cannot carry bigint)');

/** Canonical ECIES public key: 0x04 + 128 hex (see ecies.ts). */
export const EciesPubKeySchema = z
  .string()
  .regex(/^0x04[0-9a-fA-F]{128}$/, 'must be a canonical ECIES public key (0x04 + 128 hex)');

export const ConstraintsSchema = z
  .object({
    model: z.string().min(1),
    maxTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2),
  })
  .passthrough();

/** The wire form of the struct Alice signs. */
export const IntentWireSchema = z.object({
  intentHash: Bytes32Schema,
  client: AddressSchema,
  agentId: Bytes32Schema,
  price: UintStringSchema,
  deadline: UintStringSchema,
});
export type IntentWire = z.infer<typeof IntentWireSchema>;

/** Alice → Bob `/task`, the CONTENT that gets ECIES-encrypted. */
export const TaskEnvelopeSchema = z.object({
  v: z.literal(1),
  intent: IntentWireSchema,
  aliceSig: SignatureSchema,
  brief: z.string(),
  data: z.string(),
  constraints: ConstraintsSchema,
  nonce: UintStringSchema,
  /** Alice's ECIES pubkey — the result is encrypted to this (canonical form). */
  replyPubKey: EciesPubKeySchema,
});
export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;

/** Payment rail identifier — two backends, one interface. */
export const PaymentRailSchema = z.enum(['base-stealth', 'hedera-x402']);

/**
 * Bob's HTTP 402 response: "authorise payment first".
 *
 * `recipient` is NOT an address but a RECIPE: on Base it is Bob's ERC-5564 meta-address
 * (Alice derives a FRESH stealth address from it — Bob cannot know it in advance), on
 * Hedera it is a plain account id.
 */
export const PaymentRequirementsSchema = z.object({
  rail: PaymentRailSchema,
  intentHash: Bytes32Schema,
  amount: UintStringSchema,
  asset: z.string().min(1),
  decimals: z.number().int().min(0).max(18),
  recipient: z.string().min(1),
  network: z.string().min(1),
  expiresAt: z.number().int().positive(),
});
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

/**
 * The payment authorisation Alice signs, NOT YET SUBMITTED.
 *
 * `payload` is rail-specific (Base: an EIP-3009 signature; Hedera: a partially signed
 * transfer). Bob verifies it, does the work, and submits it after `JobVerified`.
 */
export const PaymentAuthorizationSchema = z.object({
  rail: PaymentRailSchema,
  intentHash: Bytes32Schema,
  payTo: z.string().min(1),
  amount: UintStringSchema,
  payload: z.unknown(),
});
export type PaymentAuthorization = z.infer<typeof PaymentAuthorizationSchema>;

/**
 * The outer body on the wire: POST /task
 *
 * `intentHash` and `replyPubKey` travel OUTSIDE the ciphertext because Bob's outer layer
 * CANNOT decrypt the payload (the key lives in the enclave) yet still needs these two to
 * route the job and deliver the result. Nothing leaks: `intentHash` is already public
 * on-chain via `JobVerified`, and `replyPubKey` sits in Alice's ERC-8004 record.
 *
 * The enclave does NOT trust these — it makes its own decisions from the fields INSIDE the
 * sealed payload.
 */
export const TaskRequestSchema = z.object({
  to: z.string().min(1),
  intentHash: Bytes32Schema,
  replyPubKey: EciesPubKeySchema,
  cipher: z.string().min(1),
  /**
   * The payment authorisation. WITHOUT IT Bob returns 402 and DOES NO WORK (CLAUDE.md §7).
   *
   * This is not an ESCROW but a signed permission: the money is still in Alice's wallet.
   * Bob holds it, does the work, and submits it AFTER `JobVerified` appears. On a fraud run
   * `JobVerified` never happens → the authorisation is never submitted.
   */
  payment: PaymentAuthorizationSchema.optional(),
});
export type TaskRequest = z.infer<typeof TaskRequestSchema>;

/**
 * The DECODED form of the body the enclave signs.
 *
 * The body itself is NOT JSON — it is `abi.encode(bytes32,bytes32,bool,bytes32)`.
 * The reason is §2.3: the contract must be able to rebuild the body from the fields rather
 * than parse it. This schema only validates the decoded form.
 */
export const TappBodySchema = z.object({
  intentHash: Bytes32Schema,
  outputHash: Bytes32Schema,
  match: z.boolean(),
  /** keccak256(ogSig) — the commitment to the signature, not the signature itself. */
  ogSigHash: Bytes32Schema,
});
export type TappBody = z.infer<typeof TappBodySchema>;

/** The Tapp seal signature — only r‖s is carried, because the wrapper discards `v`. */
export const SealSchema = z.object({
  agentId: z.string().min(1),
  sealId: z.string().min(1),
  timestamp: z.string().min(1),
  r: Bytes32Schema,
  s: Bytes32Schema,
});
export type Seal = z.infer<typeof SealSchema>;

/** Bob → Alice, ECIES-encrypted to Alice's replyPubKey. */
export const ResultEnvelopeSchema = z.object({
  v: z.literal(1),
  output: z.string(),
  /** The hex form of the raw signed body — NEVER re-stringified. */
  bodyHex: z.string().regex(/^0x[0-9a-fA-F]*$/, 'must be hex'),
  seal: SealSchema,
  ogSig: z.string().min(1),
  ogSigner: AddressSchema,
  /** 0G Storage root (P3-E bonus). */
  storageRoot: Bytes32Schema.optional(),
  /** False when the signature could not be verified inside — never silently true (P3-B rule). */
  ogVerified: z.boolean(),
});
export type ResultEnvelope = z.infer<typeof ResultEnvelopeSchema>;

/** Bob's `GET /.well-known/agent-card.json` response. */
export const AgentCardSchema = z.object({
  v: z.literal(1),
  name: z.string().min(1),
  /** ERC-8004 agentId, decimal string. */
  agentId: UintStringSchema,
  owner: AddressSchema,
  skills: z.array(z.string().min(1)).min(1),
  endpoint: z.string().url(),
  eciesPubKey: EciesPubKeySchema,
  price: z.object({
    amount: UintStringSchema,
    asset: z.string().min(1),
    decimals: z.number().int().min(0).max(18),
  }),
  /** ERC-5564 stealth meta-address (P4-B). Null while absent. */
  stealthMetaAddress: z.string().nullable(),
  /**
   * Hedera payment account (P4-C). NO recipient privacy — a deliberate roadmap v3 §07 call.
   *
   * We do NOT use `.default()`: a defaulted field splits zod's input and output types, and
   * `parseOrThrow`'s generic then binds to the input and treats the field as optional.
   * Leaving it required-but-nullable both aligns the types and rejects a missing field
   * instead of silently filling it in.
   */
  hederaAccount: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'must be a Hedera account id')
    .nullable(),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;

/**
 * The PHASE 1 result — no enclave and no 0G yet.
 *
 * Deliberately SEPARATE from `ResultEnvelope`: filling the seal/ogSig fields with fake
 * values would present a guarantee we do not yet have as if we did. Once P3-B starts
 * signing the real body, the flow moves to `ResultEnvelope`.
 */
export const EchoResultSchema = z.object({
  v: z.literal(1),
  stage: z.literal('echo'),
  /** The commitment Alice signed. */
  intentHash: Bytes32Schema,
  /** The commitment Bob recomputed from the payload. */
  recomputedIntentHash: Bytes32Schema,
  match: z.boolean(),
  /** Is the address recovered from Alice's EIP-712 signature the expected client? */
  clientSigOk: z.boolean(),
  recoveredClient: AddressSchema,
  output: z.string(),

  // --- binding signature (P1-D) ---
  // NOTE: this is NOT a verified Tapp seal signature. In PHASE 1 the binding is a local
  // function and the key does not come from an attested enclave. P3-B/P3-C replace it with
  // the real thing.
  /** The raw signed body: abi.encode(bytes32,bytes32,bool,bytes32). */
  bodyHex: z.string().regex(/^0x[0-9a-fA-F]*$/, 'must be hex'),
  /** The seal signature — `v` discarded, r‖s only (CLAUDE.md §3.1B). The contract tries both parities. */
  seal: SealSchema,
  /** The address recovered from the body signature. */
  bindingSigner: AddressSchema,
  /** The registered binding key — the PHASE 1 counterpart of the contract's enclaveSignerOf. */
  expectedBindingSigner: AddressSchema,
  bindingSigOk: z.boolean(),

  // --- 0G attestation status (comes from the compute.ts boundary) ---
  // `provider: 'none'` and `ogVerified: false` are an HONEST answer: the system says
  // "there is no TEE signature here"; it does not fabricate one.
  computeProvider: z.enum(['none', '0g-sealed-inference', 'fixture-replay']),
  ogVerified: z.boolean(),
  ogSig: z.string().optional(),
  ogSigner: AddressSchema.optional(),

  /**
   * LEVEL 0 BINDING — does the output carry Alice's signed `intentHash` VERBATIM?
   *
   * When true, this chain has been established:
   *     0G TEE signature → response body → output → intentHash → Alice's EIP-712 signature
   * Bob cannot produce that chain on his own machine; the first link comes from 0G hardware.
   *
   * WHAT IT DOES NOT COVER: that the commitment really belongs to that brief+data. The model
   * repeats it, it does not validate it. With our own attested machine this check would sit
   * inside the seal too (CLAUDE.md §11).
   */
  intentEchoed: z.boolean(),

  /**
   * P3-E: where the deliverable was archived on 0G Storage, and the key that opens it.
   *
   * `keyHex` IS A SECRET and it is safe here for one reason: this whole object is ECIES-encrypted
   * to Alice before it leaves the enclave. It is deliberately absent from `BindingResponse`, so
   * Bob's outer layer carries the root hash it will publish and nothing that reads the blob.
   *
   * Absent when storage is switched off — no root hash is ever invented (the compute.ts rule).
   */
  storage: z
    .object({
      rootHash: Bytes32Schema,
      txHash: z.string(),
      /** AES-256-GCM, 32 bytes. Alice-only. */
      keyHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte hex key'),
      bytes: z.number().int().nonnegative(),
    })
    .optional(),

  /** P0-G: stage durations INSIDE the enclave. Durations only — never content. */
  stageMs: z.record(z.number()).optional(),
});
export type EchoResult = z.infer<typeof EchoResultSchema>;

// ---------------------------------------------------------------------------
// bigint <-> wire conversion — in ONE place
// ---------------------------------------------------------------------------

export function intentToWire(intent: Intent): IntentWire {
  return {
    intentHash: intent.intentHash,
    client: intent.client,
    agentId: intent.agentId,
    price: intent.price.toString(),
    deadline: intent.deadline.toString(),
  };
}

export function intentFromWire(wire: IntentWire): Intent {
  return {
    intentHash: wire.intentHash,
    client: wire.client,
    agentId: wire.agentId,
    price: BigInt(wire.price),
    deadline: BigInt(wire.deadline),
  };
}

/** Reject a payload that fails the schema with a meaningful error (the caller returns 400). */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  throw new Error(`${what} failed schema validation — ${detail}`);
}

export type { Constraints };
