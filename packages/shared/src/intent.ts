// intent.ts — the intentHash commitment + Alice's EIP-712 signature (BUILD-PLAN §2.3).
//
//   intentHash = keccak256(abi.encode(
//     bytes32 briefHash,        // hashUtf8(brief)
//     bytes32 dataHash,         // hashUtf8(data)
//     bytes32 constraintsHash,  // hashUtf8(canonicalJson(constraints))
//     uint256 price,            // smallest unit (USDC: 6 decimals, HBAR: tinybars)
//     uint256 nonce
//   ))
//
// abi.encode — NOT encodePacked. Using packed produces a silent mismatch between TS and
// Solidity (BUILD-PLAN P1-A ⛔ note); packed can also blur adjacent dynamic fields into
// each other. We want a fixed 5×32 bytes.
//
// Design note (§2.3): Alice signs the `intentHash` COMMITMENT, not the content.
// `agentId` is inside the struct, otherwise the same signature could be replayed against
// another worker. `price` is inside because settlement reads it. `deadline` is inside
// because an expired intent must not be accepted.

import {
  AbiCoder,
  type Signer,
  type TypedDataDomain,
  type TypedDataField,
  getAddress,
  keccak256,
  toBeHex,
  verifyTypedData,
  zeroPadValue,
} from 'ethers';
import { hashCanonical, hashUtf8 } from './canonical.js';

/** Technical constraints of the job. Key order is irrelevant — canonicalJson sorts them. */
export interface Constraints {
  model: string;
  maxTokens: number;
  temperature: number;
  [extra: string]: unknown;
}

/** The raw inputs that make up the intentHash. */
export interface IntentInputs {
  brief: string;
  data: string;
  constraints: Constraints;
  /** Smallest unit (USDC 6 decimals, HBAR tinybars). */
  price: bigint;
  nonce: bigint;
}

/** The struct Alice signs with EIP-712. */
export interface Intent {
  intentHash: string;
  client: string;
  /** The ERC-8004 agentId right-aligned into bytes32. */
  agentId: string;
  price: bigint;
  deadline: bigint;
}

/**
 * An OBVIOUSLY fake verifyingContract, used until P3-A is deployed.
 *
 * It lives here so that its placeholder nature is visible from the name: an intent signed
 * with this address cannot be verified by the real Verifier. It must stop being used once
 * VERIFIER_ADDRESS is populated — callers print a WARNING when the env var is empty.
 */
export const PLACEHOLDER_VERIFIER = '0x00000000000000000000000000000000DeaDBeef';

export const EIP712_DOMAIN_NAME = 'ConfidentialAgents';
export const EIP712_DOMAIN_VERSION = '1';
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const INTENT_TYPES: Record<string, TypedDataField[]> = {
  Intent: [
    { name: 'intentHash', type: 'bytes32' },
    { name: 'client', type: 'address' },
    { name: 'agentId', type: 'bytes32' },
    { name: 'price', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

/**
 * The EIP-712 domain. `verifyingContract` is mandatory and EXPLICIT — we give no default,
 * because an intent signed against the wrong (e.g. zero) address becomes silently
 * unverifiable on the contract side and the failure only surfaces in P3-D.
 */
export function intentDomain(verifyingContract: string, chainId: number = BASE_SEPOLIA_CHAIN_ID): TypedDataDomain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: getAddress(verifyingContract),
  };
}

/** Convert the numeric ERC-8004 agentId (e.g. 8429n) into bytes32. */
export function agentIdToBytes32(agentId: bigint | number | string): string {
  return zeroPadValue(toBeHex(BigInt(agentId)), 32);
}

/**
 * The 5-field commitment from §2.3. The same input always produces the same output —
 * there is no implicit input such as `Date.now()`.
 */
export function buildIntentHash(inputs: IntentInputs): string {
  const briefHash = hashUtf8(inputs.brief);
  const dataHash = hashUtf8(inputs.data);
  const constraintsHash = hashCanonical(inputs.constraints);
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256'],
      [briefHash, dataHash, constraintsHash, inputs.price, inputs.nonce],
    ),
  );
}

/** Intermediate hashes — so that while debugging you can see which field disagrees. */
export function intentHashParts(inputs: IntentInputs): {
  briefHash: string;
  dataHash: string;
  constraintsHash: string;
  price: bigint;
  nonce: bigint;
  intentHash: string;
} {
  return {
    briefHash: hashUtf8(inputs.brief),
    dataHash: hashUtf8(inputs.data),
    constraintsHash: hashCanonical(inputs.constraints),
    price: inputs.price,
    nonce: inputs.nonce,
    intentHash: buildIntentHash(inputs),
  };
}

/** Alice signs the intent with EIP-712. */
export async function signIntent(
  intent: Intent,
  signer: Signer,
  verifyingContract: string,
  chainId: number = BASE_SEPOLIA_CHAIN_ID,
): Promise<string> {
  return signer.signTypedData(intentDomain(verifyingContract, chainId), INTENT_TYPES, intent);
}

/**
 * Recover the address that produced the signature.
 *
 * The contract does exactly this: even if Bob supplies the signature+intent pair, it finds
 * the signer via a digest rebuilt from the struct's OWN fields (§2.3, P3-A step 3).
 */
export function recoverIntentSigner(
  intent: Intent,
  signature: string,
  verifyingContract: string,
  chainId: number = BASE_SEPOLIA_CHAIN_ID,
): string {
  return verifyTypedData(intentDomain(verifyingContract, chainId), INTENT_TYPES, intent, signature);
}
