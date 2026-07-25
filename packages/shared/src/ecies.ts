// ecies.ts — the confidential messaging layer (BUILD-PLAN P1-B).
//
// A wrapper around `eth-crypto`. The encrypted payload travels over the wire in
// `EthCrypto.cipher.stringify` format (a single hex string).
//
// KEY FORMAT — there are two different representations, and mixing them up causes a
// silent failure:
//   - eth-crypto public key: 128 hex digits with NO 0x prefix (and no 04 prefix either).
//   - Our wire/registry format: 0x04 + 128 hex (standard SEC1 uncompressed).
// The CANONICAL form is what gets written to ERC-8004 as `eciesPubKey`; this module
// converts at the boundary. Comparisons must always be done on the canonical form.
//
// Privacy boundary (CLAUDE.md §11): this layer hides the content. It does NOT hide who
// is talking to whom (endpoint, IP, timing) — the answer to that is stealth payments,
// not this.

import EthCryptoDefault from 'eth-crypto';
import { computeAddress } from 'ethers';

// eth-crypto CJS/ESM bridge: it may also arrive under `default`.
const EthCrypto = (EthCryptoDefault as unknown as { default?: typeof EthCryptoDefault }).default ?? EthCryptoDefault;

export interface EciesIdentity {
  /** 0x + 64 hex. */
  privateKey: string;
  /** Canonical form: 0x04 + 128 hex. */
  publicKey: string;
  address: string;
}

const RAW_PUBKEY = /^[0-9a-fA-F]{128}$/;
const CANONICAL_PUBKEY = /^0x04[0-9a-fA-F]{128}$/;

/** From any accepted representation to the raw 128 hex that eth-crypto expects. */
export function toRawPublicKey(publicKey: string): string {
  const v = publicKey.trim();
  if (RAW_PUBKEY.test(v)) return v.toLowerCase();
  if (CANONICAL_PUBKEY.test(v)) return v.slice(4).toLowerCase();
  if (/^04[0-9a-fA-F]{128}$/.test(v)) return v.slice(2).toLowerCase();
  throw new Error(
    `unrecognised ECIES public key format (length ${v.length}). Expected: 0x04+128 hex, 04+128 hex or bare 128 hex.`,
  );
}

/** Canonical form: 0x04 + 128 hex. This is what goes into the registry and the agent card. */
export function toCanonicalPublicKey(publicKey: string): string {
  return `0x04${toRawPublicKey(publicKey)}`;
}

export function eciesPublicKeyOf(privateKey: string): string {
  return toCanonicalPublicKey(EthCrypto.publicKeyByPrivateKey(normalizePrivateKey(privateKey)));
}

function normalizePrivateKey(privateKey: string): string {
  const v = privateKey.trim();
  const withPrefix = v.startsWith('0x') ? v : `0x${v}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error('ECIES private key must be 0x + 64 hex digits');
  }
  return withPrefix;
}

export function createEciesIdentity(): EciesIdentity {
  const id = EthCrypto.createIdentity();
  return {
    privateKey: id.privateKey,
    publicKey: toCanonicalPublicKey(id.publicKey),
    address: id.address,
  };
}

/** The EVM address implied by the public key — used to check a registration matches the key. */
export function addressFromPublicKey(publicKey: string): string {
  return computeAddress(toCanonicalPublicKey(publicKey));
}

/** Encrypt a raw string. */
export async function encryptStringFor(publicKey: string, plaintext: string): Promise<string> {
  const encrypted = await EthCrypto.encryptWithPublicKey(toRawPublicKey(publicKey), plaintext);
  return EthCrypto.cipher.stringify(encrypted);
}

/**
 * Decrypt.
 *
 * A wrong key or tampered ciphertext THROWS with `Bad MAC` — it does not silently
 * return corrupt data. That behaviour is a gate criterion (P1-B), not an accident:
 * payload integrity is the assumption underneath intent-binding.
 */
export async function decryptStringWith(privateKey: string, cipher: string): Promise<string> {
  const parsed = EthCrypto.cipher.parse(cipher);
  return EthCrypto.decryptWithPrivateKey(normalizePrivateKey(privateKey), parsed);
}

/** Serialise the object to JSON and encrypt it. */
export async function encryptFor(publicKey: string, payload: unknown): Promise<string> {
  return encryptStringFor(publicKey, JSON.stringify(payload));
}

/** Decrypt and parse the JSON. Schema validation is the CALLER's job (schema.ts parseOrThrow). */
export async function decryptWith<T = unknown>(privateKey: string, cipher: string): Promise<T> {
  return JSON.parse(await decryptStringWith(privateKey, cipher)) as T;
}
