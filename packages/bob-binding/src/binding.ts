// binding.ts — the HONEST binding logic. This file is the code that runs inside the enclave.
//
// TWO BOUNDARIES live here at once:
//
// 1. INTEGRITY (P1-D): "There is NO FRAUD_MODE in the enclave. Fraud lives in the outer
//    layer." There is no cheat switch here, no environment-variable read, no conditional
//    behaviour. It recomputes whatever it received and reports honestly.
//
// 2. PRIVACY (CLAUDE.md §2): ECIES decryption happens HERE. The outer layer (bob-agent)
//    CANNOT decrypt the payload — it holds no key, only ciphertext ever reaches it. That is
//    the only way the claim "the infrastructure cannot see the data" becomes true.
//
//    What goes back to the outer layer is deliberately narrow too: the body, the seal, and
//    fields that are going on chain anyway. `brief`, `data` and `output` NEVER LEAVE — the
//    result is encrypted directly to Alice's key and delivered that way.
//
// The P3-B rule applies and is intentional: even when `match === false` the flow CONTINUES
// and the body IS SIGNED. The enclave does not lie, it only reports; the contract rejects.
//
// PHASE 1 BOUNDARY — honesty note:
//   - There is no 0G Sealed Inference call here; the output arrives from the `compute.ts`
//     boundary and, while 0G is not connected, it is a placeholder and `ogSigHash` stays zero.
//   - The signature format is the CLAUDE.md §3.1(B) seal format, but the signing key is NOT
//     an attested enclave seal key — it is a local binding key (P3-C will replace it).

import { AbiCoder, Wallet, keccak256, recoverAddress, toUtf8Bytes } from 'ethers';
import {
  TaskEnvelopeSchema,
  buildIntentHash,
  createNoComputeBackend,
  decryptWith,
  eciesPublicKeyOf,
  encryptFor,
  parseOrThrow,
  recoverIntentSigner,
  recoverSealCandidates,
  signSeal,
  verifySeal,
  type ComputeBackend,
  type ComputeProvider,
  type Constraints,
  type EchoResult,
  type SealFields,
  type SealSignature,
  type StageMs,
  createStopwatch,
} from '@ca/shared';

/** The work order entering the enclave — NOT THE CONTENT, the ENCRYPTED PAYLOAD. */
export interface BindingRequest {
  /** The payload Alice ECIES-encrypted. It is not decrypted outside the enclave. */
  cipher: string;
  /** The first field of the seal preimage — the wrapper's agent id (NOT the ERC-8004 agentId). */
  agentId: string;
  /** The seal id, issued once per container lifetime. */
  sealId: string;
  /** Decimal seconds. */
  timestamp: string;
  /** The EIP-712 domain — for verifying Alice's signature INSIDE the enclave. */
  verifyingContract: string;
  chainId?: number;
}

/** The keys the enclave owns. Neither is handed to the outer layer. */
export interface EnclaveKeys {
  /** The key that DECRYPTS the payload. The pubkey published in the card is its counterpart. */
  ecies: string;
  /** The binding/seal key that signs the body. */
  binding: string;
}

/**
 * What the enclave returns to the outer layer.
 *
 * DELIBERATELY NARROW: every field is either going on chain or is not secret. `brief`,
 * `data` and `output` are NOT here — they sit inside `resultCipher`, under Alice's key.
 */
export interface BindingResponse {
  /** The hash the client committed to inside the payload. */
  claimedIntentHash: string;
  /** The commitment RECOMPUTED from the content. */
  recomputedIntentHash: string;
  match: boolean;
  outputHash: string;
  /** keccak256(ogSig) — zero when there is no 0G signature (no fabricated commitment is written). */
  ogSigHash: string;
  ogSig?: string;
  ogSigner?: string;
  ogVerified: boolean;
  computeProvider: ComputeProvider;
  computeLatencyMs: number;
  /** Does the output carry Alice's `intentHash` verbatim (Level 0 binding)? */
  intentEchoed: boolean;
  /**
   * Stage durations INSIDE the enclave (the P0-G distribution).
   * Durations ONLY — never content; the privacy boundary stays intact.
   */
  stageMs: StageMs;
  /** The raw signed body: abi.encode(bytes32,bytes32,bool,bytes32). */
  bodyHex: string;
  /** The seal signature — `v` discarded just as the wrapper does (CLAUDE.md §3.1B). */
  seal: SealSignature;
  signer: string;
  /** The address recovered from Alice's EIP-712 signature (verified INSIDE the enclave). */
  recoveredClient: string;
  clientSigOk: boolean;
  /** The result, encrypted to Alice's `replyPubKey`. The outer layer cannot decrypt it. */
  resultCipher: string;
}

const ZERO32 = `0x${'00'.repeat(32)}`;

/** §2.3: the body is NOT JSON — abi.encode, so the contract can rebuild it from the fields. */
export function encodeBody(intentHash: string, outputHash: string, match: boolean, ogSigHash: string): string {
  return AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes32', 'bool', 'bytes32'],
    [intentHash, outputHash, match, ogSigHash],
  );
}

export function decodeBody(bodyHex: string): {
  intentHash: string;
  outputHash: string;
  match: boolean;
  ogSigHash: string;
} {
  const decoded = AbiCoder.defaultAbiCoder().decode(['bytes32', 'bytes32', 'bool', 'bytes32'], bodyHex);
  return {
    intentHash: decoded[0] as string,
    outputHash: decoded[1] as string,
    match: decoded[2] as boolean,
    ogSigHash: decoded[3] as string,
  };
}

/**
 * Recover the address that signed the body (brute-forcing `v`).
 *
 * When an expected address is given it returns the matching candidate; otherwise the first.
 * Because the wrapper discards `v`, there is no single "correct" answer.
 */
export function recoverBindingSigner(bodyHex: string, seal: SealSignature, expectedSigner?: string): string {
  const candidates = recoverSealCandidates(seal, bodyHex, seal.r, seal.s);
  if (expectedSigner) {
    const want = expectedSigner.toLowerCase();
    const hit = candidates.find((c) => c.address.toLowerCase() === want);
    if (hit) return hit.address;
  }
  return candidates[0]?.address ?? '0x0000000000000000000000000000000000000000';
}

/** The ECIES public key the enclave publishes — what Alice encrypts to. */
export function enclavePublicKey(keys: Pick<EnclaveKeys, 'ecies'>): string {
  return eciesPublicKeyOf(keys.ecies);
}

export interface RunBindingOptions {
  compute?: ComputeBackend;
  /**
   * Test hook: the plaintext the enclave DECRYPTED.
   *
   * It runs INSIDE the enclave and leaks nothing to the outer layer. It exists so gate tests
   * can see whether the payload was decrypted correctly.
   */
  onDecrypted?: (envelope: { brief: string; data: string; nonce: string }) => void;
}

/**
 * The honest binding flow — DECRYPTION NOW HAPPENS HERE TOO.
 *
 * 1. DECRYPT the payload (the outer layer cannot)
 * 2. Validate against the schema
 * 3. RECOMPUTE intentHash from the content → match
 * 4. Verify Alice's EIP-712 signature (informational; the real decision is the contract's)
 * 5. Call the model (the compute boundary)
 * 6. Build the body and SIGN it — even when match is false
 * 7. Encrypt the result to ALICE's key
 */
export async function runBinding(
  request: BindingRequest,
  keys: EnclaveKeys,
  options: RunBindingOptions = {},
): Promise<BindingResponse> {
  const compute = options.compute ?? createNoComputeBackend();
  const sw = createStopwatch();

  // 1-2. DECRYPT and validate. A malformed payload throws here; the outer layer never sees the content.
  const decrypted = await decryptWith(keys.ecies, request.cipher);
  const envelope = parseOrThrow(TaskEnvelopeSchema, decrypted, 'TaskEnvelope');
  sw.mark('ecies_decrypt');
  options.onDecrypted?.({ brief: envelope.brief, data: envelope.data, nonce: envelope.nonce });

  // 3. Recompute the commitment from the RECEIVED CONTENT, not from the CLAIM.
  const claimedIntentHash = envelope.intent.intentHash;
  const recomputedIntentHash = buildIntentHash({
    brief: envelope.brief,
    data: envelope.data,
    constraints: envelope.constraints as Constraints,
    price: BigInt(envelope.intent.price),
    nonce: BigInt(envelope.nonce),
  });
  const match = recomputedIntentHash === claimedIntentHash;
  sw.mark('recompute');

  // 4. Did Alice really sign this? The final decision belongs to the contract.
  let recoveredClient = '0x0000000000000000000000000000000000000000';
  let clientSigOk = false;
  try {
    recoveredClient = recoverIntentSigner(
      {
        intentHash: claimedIntentHash,
        client: envelope.intent.client,
        agentId: envelope.intent.agentId,
        price: BigInt(envelope.intent.price),
        deadline: BigInt(envelope.intent.deadline),
      },
      envelope.aliceSig,
      request.verifyingContract,
      request.chainId,
    );
    clientSigOk = recoveredClient.toLowerCase() === envelope.intent.client.toLowerCase();
  } catch {
    clientSigOk = false;
  }
  sw.mark('client_sig_verify');

  // 5. Call the model. It is called EVEN IF `match === false`, and the result is signed —
  //    the enclave does not lie, it only reports.
  const computed = await compute.run({
    brief: envelope.brief,
    data: envelope.data,
    constraints: envelope.constraints as Constraints,
    // LEVEL 0 BINDING: carry the commitment through the model. Because we have no attested
    // machine of our own, we route one end of the binding through 0G's REAL enclave.
    commitment: claimedIntentHash,
  });

  // Is the commitment really in the output? We do NOT LEAVE this check TO THE BACKEND — a
  // backend could simply claim it inserted it. The enclave looks at the raw output itself.
  //
  // We look for an exact match: in a 64-digit hex value a one-character shift breaks the
  // binding, and there is no such thing as "approximately passing".
  const intentEchoed = computed.output.includes(claimedIntentHash);

  const output = match
    ? computed.output
    : `[binding] The recomputed commitment does not match what the client signed — ` +
      `this is not the job that was ordered. (compute: ${computed.provider})`;

  sw.mark('compute_0g');

  const outputHash = keccak256(toUtf8Bytes(output));
  const ogSigHash = computed.ogSig ? keccak256(computed.ogSig) : ZERO32;
  const bodyHex = encodeBody(claimedIntentHash, outputHash, match, ogSigHash);

  // 6. Sign in the seal format. `v` is discarded deliberately; the contract tries 27/28 itself.
  const wallet = new Wallet(keys.binding);
  const fields: SealFields = {
    agentId: request.agentId,
    sealId: request.sealId,
    timestamp: request.timestamp,
  };
  const seal = signSeal(fields, bodyHex, keys.binding);
  sw.mark('seal_sign');

  const bindingSigner = recoverBindingSigner(bodyHex, seal, wallet.address);
  const result: EchoResult = {
    v: 1,
    stage: 'echo',
    intentHash: claimedIntentHash,
    recomputedIntentHash,
    match,
    clientSigOk,
    recoveredClient,
    output,
    bodyHex,
    seal,
    bindingSigner,
    expectedBindingSigner: wallet.address,
    bindingSigOk: bindingSigner.toLowerCase() === wallet.address.toLowerCase(),
    computeProvider: computed.provider,
    ogVerified: computed.ogVerified,
    ogSig: computed.ogSig,
    ogSigner: computed.ogSigner,
    intentEchoed,
    stageMs: sw.stages(),
  };

  // 7. Encrypt the result to ALICE's key. The replyPubKey from INSIDE the payload is used —
  //    not the copy the outer layer forwarded over the wire (that one can be tampered with).
  const resultCipher = await encryptFor(envelope.replyPubKey, result);
  sw.mark('ecies_encrypt_result');

  return {
    claimedIntentHash,
    recomputedIntentHash,
    match,
    outputHash,
    ogSigHash,
    ogSig: computed.ogSig,
    ogSigner: computed.ogSigner,
    ogVerified: computed.ogVerified,
    computeProvider: computed.provider,
    computeLatencyMs: computed.latencyMs,
    intentEchoed,
    stageMs: sw.stages(),
    bodyHex,
    seal,
    signer: wallet.address,
    recoveredClient,
    clientSigOk,
    resultCipher,
  };
}

/** Helper showing that the enclave verifies its own signature (for tests). */
export function selfCheckSeal(response: BindingResponse): boolean {
  return verifySeal(response.seal, response.bodyHex, response.signer);
}

export { recoverAddress };
