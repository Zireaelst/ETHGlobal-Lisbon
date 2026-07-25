// fraud.ts — Bob's fraud layer, OUTSIDE THE ENCLAVE (BUILD-PLAN P1-D).
//
// None of this code enters the enclave. `@ca/bob-binding` behaves honestly under every
// condition. The demo's one-sentence claim comes from that separation:
// "Bob can cheat, but the enclave cannot lie on his behalf."
//
// IMPORTANT — once the ECIES boundary moved into the enclave, the SHAPE OF THE FRAUD CHANGED:
// Bob can no longer DECRYPT Alice's payload, so he cannot "edit" the brief. The only thing he
// can do is encrypt HIS OWN payload to the enclave's public key and send it in place of hers.
// That is precisely the attack available in the real world — and Bob is inventing it blind,
// because he never sees what was ordered. The narrative is stronger for it: "answering the
// wrong job without even knowing what was asked".
//
// | Mode        | What Bob does                                      | Expected result|
// |-------------|---------------------------------------------------|----------------|
// | none        | forwards the payload untouched                     | JobVerified    |
// | substitute  | sends the enclave a payload HE invented            | MatchFalse     |
// | tamper      | same mechanism, framed as "I corrupted the data"   | MatchFalse     |
// | forge       | signs the body with a key OUTSIDE the enclave      | BadEnclaveSig  |
// | selfintent  | invents his own intent, no Alice signature         | BadClientSig   |

import type { BindingRequest, BindingResponse } from '@ca/bob-binding';
import {
  buildIntentHash,
  encryptFor,
  signSeal,
  type Constraints,
  type IntentWire,
} from '@ca/shared';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

export const FRAUD_MODES = ['none', 'substitute', 'tamper', 'forge', 'selfintent'] as const;
export type FraudMode = (typeof FRAUD_MODES)[number];

export function isFraudMode(v: unknown): v is FraudMode {
  return typeof v === 'string' && (FRAUD_MODES as readonly string[]).includes(v);
}

/** The verdict the contract is expected to return for each mode — the gate expects this. */
export const EXPECTED_OUTCOME: Record<FraudMode, string> = {
  none: 'JobVerified',
  substitute: 'MatchFalse',
  tamper: 'MatchFalse',
  forge: 'BadEnclaveSig',
  selfintent: 'BadClientSig',
};

/** The only things Bob's outer layer CAN SEE on the wire. */
export interface WireContext {
  /** Alice's commitment — it travels outside the ciphertext (it is public on chain anyway). */
  intentHash: string;
  /** Alice's ECIES pubkey — so the result can be delivered to her. */
  replyPubKey: string;
  /** The enclave's pubkey — Bob can encrypt HIS OWN payload to it. */
  enclavePublicKey: string;
  /** Bob's ERC-8004 agentId (bytes32) — needed when fabricating an intent. */
  agentIdBytes32: string;
}

/** The fixed content of the payload Bob invents — so the demo stays reproducible. */
const FORGED_CONSTRAINTS: Constraints = { model: 'cheap-model', maxTokens: 128, temperature: 0 };
const FORGED_NONCE = 424242n;
const FORGED_PRICE = 1_000_000n;

/**
 * Alter the payload BEFORE it ENTERS the enclave.
 *
 * Because Bob cannot decrypt Alice's payload, "editing the brief" is impossible; the only
 * thing he can do is encrypt HIS OWN payload and put it in its place.
 */
export async function applyPreBindingFraud(
  mode: FraudMode,
  request: BindingRequest,
  ctx: WireContext,
): Promise<BindingRequest> {
  if (mode === 'none' || mode === 'forge') return request;

  const forged = await buildForgedEnvelope(mode, ctx);
  return { ...request, cipher: forged };
}

async function buildForgedEnvelope(mode: FraudMode, ctx: WireContext): Promise<string> {
  const brief =
    mode === 'selfintent'
      ? 'Bob invented this job so he could claim payment for it.'
      : mode === 'tamper'
        ? 'Bob claims to have analysed the data, with figures he made up.'
        : 'Write a short generic market summary. (Bob substituted this brief.)';
  const data =
    mode === 'tamper'
      ? 'Q3-2026 revenue 99,999,999 EUR (fabricated — Bob never saw the real data).'
      : 'Bob has no access to the real dataset.';

  // `selfintent`: Bob fabricates a commitment that is CONSISTENT WITH THE CONTENT. That way
  // the enclave honestly reports match:true and the rejection is forced to come from the
  // CLIENT SIGNATURE. Had he fabricated an inconsistent one, the mode would collapse into
  // MatchFalse and we would lose a distinct rejection code.
  const intentHash =
    mode === 'selfintent'
      ? buildIntentHash({ brief, data, constraints: FORGED_CONSTRAINTS, price: FORGED_PRICE, nonce: FORGED_NONCE })
      : ctx.intentHash; // substitute/tamper: carries Alice's commitment but different content

  // There is no Alice signature and Bob cannot produce one — he signs with a random wallet.
  // The enclave will honestly report this as `clientSigOk: false`.
  const impostor = new Wallet(keccak256(toUtf8Bytes('bob-impostor-client-key')));
  const intent: IntentWire = {
    intentHash,
    client: impostor.address,
    agentId: ctx.agentIdBytes32,
    price: FORGED_PRICE.toString(),
    deadline: (BigInt(Math.floor(Date.now() / 1000)) + 3600n).toString(),
  };

  return encryptFor(ctx.enclavePublicKey, {
    v: 1,
    intent,
    // A well-formed signature that does NOT belong to Alice.
    aliceSig: `0x${'11'.repeat(65)}`,
    brief,
    data,
    constraints: FORGED_CONSTRAINTS,
    nonce: FORGED_NONCE.toString(),
    // Her own pubkey is preserved so Alice can still read the answer: Bob wants to get paid,
    // not to leave Alice deaf.
    replyPubKey: ctx.replyPubKey,
  });
}

/**
 * Corrupt the result AFTER it RETURNS from the enclave.
 *
 * `forge`: the body is correct but the signature is made with Bob's own key rather than the
 * enclave's. Because it does not match the registered `enclaveSignerOf[agentId]`, the contract
 * rejects it.
 */
export function applyPostBindingFraud(mode: FraudMode, response: BindingResponse): BindingResponse {
  if (mode !== 'forge') return response;

  const rogueKey = keccak256(toUtf8Bytes('bob-rogue-key/not-the-enclave'));
  const rogue = new Wallet(rogueKey);
  return {
    ...response,
    seal: signSeal(
      { agentId: response.seal.agentId, sealId: response.seal.sealId, timestamp: response.seal.timestamp },
      response.bodyHex,
      rogueKey,
    ),
    signer: rogue.address,
  };
}

export type { Constraints };
