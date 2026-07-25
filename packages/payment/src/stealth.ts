// stealth.ts — ERC-5564 stealth address derivation (scheme 1: secp256k1 + view tag).
//
// Goal: while Bob's registered identity is public, a payment made to him must NOT be
// LINKABLE to that identity. Bob publishes a "meta-address"; Alice derives a FRESH address
// from it for every job. On chain you see "an address received USDC", you do not see that
// the address is Bob's.
//
// The scheme (ERC-5564 §scheme 1):
//   Bob:    k = spending key, v = viewing key
//           meta-address = "st:<chain>:0x" + compressed(K) + compressed(V)
//   Alice:  r = ephemeral key,  R = r·G
//           S     = compressed(r·V)                 ← shared secret
//           s_h   = keccak256(S)
//           P     = K + s_h·G                       ← stealth public key
//           address = address(P),  viewTag = s_h[0]
//   Bob:    S = compressed(v·R) → the same s_h
//           p = (k + s_h) mod n                     ← stealth PRIVATE key
//
// The `viewTag` makes scanning cheap: instead of a full derivation per announcement Bob
// compares a single byte first (eliminating 255/256 announcements early).
//
// CRITICAL: "we produced an address" proves nothing. The proof is that Bob can SPEND from
// that address — gate:P4-B tests it by actually withdrawing the funds.

import { SigningKey, computeAddress, getBytes, hexlify, keccak256, toUtf8Bytes } from 'ethers';

/** The secp256k1 group order. */
const CURVE_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

/** ERC-5564 scheme 1 = secp256k1, with view tag. */
export const SCHEME_ID = 1n;

export interface StealthKeys {
  /** The spending key — what moves the money. */
  spendingPrivateKey: string;
  /** The viewing key — what answers "is this mine?". It grants NO SPENDING AUTHORITY. */
  viewingPrivateKey: string;
  spendingPublicKey: string;
  viewingPublicKey: string;
  /** "st:base:0x<K><V>" */
  metaAddress: string;
}

export interface StealthPayment {
  /** The fresh address Alice will pay. */
  stealthAddress: string;
  /** The ephemeral public key published in the announcement (compressed). */
  ephemeralPublicKey: string;
  /** The single byte that makes scanning cheap. */
  viewTag: number;
  /** Metadata for the ERC-5564 Announcer (first byte = view tag). */
  metadata: string;
}

function assertPriv(key: string, what: string): string {
  const v = key.startsWith('0x') ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`stealth: ${what} must be 0x + 64 hex digits`);
  return v;
}

/** Produce Bob's meta-address. TWO SEPARATE keys — viewing grants no spending authority. */
export function createStealthKeys(spendingPrivateKey: string, viewingPrivateKey: string, chain = 'base'): StealthKeys {
  const k = assertPriv(spendingPrivateKey, 'spendingPrivateKey');
  const v = assertPriv(viewingPrivateKey, 'viewingPrivateKey');
  const K = SigningKey.computePublicKey(k, true);
  const V = SigningKey.computePublicKey(v, true);
  return {
    spendingPrivateKey: k,
    viewingPrivateKey: v,
    spendingPublicKey: K,
    viewingPublicKey: V,
    metaAddress: `st:${chain}:0x${K.slice(2)}${V.slice(2)}`,
  };
}

export interface ParsedMetaAddress {
  chain: string;
  spendingPublicKey: string;
  viewingPublicKey: string;
}

export function parseStealthMetaAddress(metaAddress: string): ParsedMetaAddress {
  const m = /^st:([a-z0-9]+):0x([0-9a-fA-F]{66})([0-9a-fA-F]{66})$/.exec(metaAddress.trim());
  if (!m) {
    throw new Error(
      `stealth: unrecognised meta-address format. Expected "st:<chain>:0x<66 hex><66 hex>" (two compressed pubkeys).`,
    );
  }
  return { chain: m[1]!, spendingPublicKey: `0x${m[2]}`, viewingPublicKey: `0x${m[3]}` };
}

/** The scalar derived from the shared secret: s_h = keccak256(compressed(shared)). */
function sharedScalar(privateKey: string, publicKey: string): string {
  const shared = new SigningKey(privateKey).computeSharedSecret(publicKey);
  // ERC-5564 hashes the COMPRESSED point — not compressing silently produces a different
  // address and Bob never finds the money.
  return keccak256(SigningKey.computePublicKey(shared, true));
}

/** address(P + s_h·G) — must give the same result on Alice's side and Bob's. */
function stealthAddressFrom(spendingPublicKey: string, scalar: string): string {
  const scalarPoint = SigningKey.computePublicKey(scalar, true);
  const stealthPub = SigningKey.addPoints(spendingPublicKey, scalarPoint, false);
  return computeAddress(stealthPub);
}

/**
 * ALICE: derive a fresh stealth address from the meta-address.
 *
 * `ephemeralPrivateKey` may be supplied for tests; in production it must be FRESH and random
 * for every payment — reusing it links two payments together.
 */
export function deriveStealthPayment(metaAddress: string, ephemeralPrivateKey: string): StealthPayment {
  const { spendingPublicKey, viewingPublicKey } = parseStealthMetaAddress(metaAddress);
  const r = assertPriv(ephemeralPrivateKey, 'ephemeralPrivateKey');

  const scalar = sharedScalar(r, viewingPublicKey);
  const viewTag = getBytes(scalar)[0]!;

  return {
    stealthAddress: stealthAddressFrom(spendingPublicKey, scalar),
    ephemeralPublicKey: SigningKey.computePublicKey(r, true),
    viewTag,
    metadata: hexlify(new Uint8Array([viewTag])),
  };
}

/**
 * BOB: does this announcement belong to me?
 *
 * It checks the view tag first (one byte, cheap); if that matches it performs the full
 * derivation. Only the VIEWING key is needed — the spending key is not used in this step.
 */
export function checkAnnouncement(
  keys: Pick<StealthKeys, 'viewingPrivateKey' | 'spendingPublicKey'>,
  ephemeralPublicKey: string,
  expectedViewTag?: number,
): { stealthAddress: string; scalar: string } | null {
  const scalar = sharedScalar(keys.viewingPrivateKey, ephemeralPublicKey);
  const viewTag = getBytes(scalar)[0]!;
  if (expectedViewTag !== undefined && viewTag !== expectedViewTag) return null;
  return { stealthAddress: stealthAddressFrom(keys.spendingPublicKey, scalar), scalar };
}

/**
 * BOB: derive the stealth address's PRIVATE key — this is what moves the money.
 *
 * p = (k + s_h) mod n. Skipping the modulo produces an invalid key in the rare case where
 * k + s_h >= n, and then the funds are unrecoverable.
 */
export function computeStealthPrivateKey(
  keys: Pick<StealthKeys, 'spendingPrivateKey' | 'viewingPrivateKey'>,
  ephemeralPublicKey: string,
): string {
  const scalar = sharedScalar(keys.viewingPrivateKey, ephemeralPublicKey);
  const k = BigInt(keys.spendingPrivateKey);
  const sum = (k + BigInt(scalar)) % CURVE_ORDER;
  if (sum === 0n) throw new Error('stealth: derived key is zero — invalid');
  return `0x${sum.toString(16).padStart(64, '0')}`;
}

/**
 * DETERMINISTICALLY derive an agent's stealth keys from its root wallet key.
 *
 * This keeps the meta-address identical on every run (so the demo is reproducible) and
 * removes the need to store a separate secret. The spending and viewing keys are derived
 * from DIFFERENT labels: even if the viewing key leaks, the money cannot be spent.
 */
export function deriveAgentStealthKeys(rootPrivateKey: string, label = 'bob', chain = 'base'): StealthKeys {
  return createStealthKeys(
    keccak256(toUtf8Bytes(`stealth/spending/${label}/${rootPrivateKey}`)),
    keccak256(toUtf8Bytes(`stealth/viewing/${label}/${rootPrivateKey}`)),
    chain,
  );
}

export { CURVE_ORDER };
