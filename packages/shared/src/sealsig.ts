// sealsig.ts — the Tapp seal signature: building the preimage, signing, and recovering
// by brute-forcing v.
//
// SOURCE: CLAUDE.md §3.1(B) — the scheme extracted from the `agent-wrapper` source:
//
//   digest    = keccak256( "agentId|sealId|timestamp|hex(sha256(body))" )
//   signature = secp256k1, 64-byte R‖S, **v DISCARDED**, **NO EIP-191 PREFIX**
//
// The body is `sha256`'d first, hex-encoded, folded into a pipe-joined ASCII string, and
// then the `keccak256` of that string is signed. So two different hash primitives are used
// back to back — confusing them produces a silent mismatch.
//
// ⚠️ UNVERIFIED DEGREES OF FREEDOM (BUILD-PLAN U1/U2, to be closed by P0-C):
// The three choices below are currently ASSUMPTIONS. Once a live Tapp signature is
// captured, `scripts/recover.js` will find the correct variant, and this is the ONLY PLACE
// that changes (plus `Verifier._sealDigest` on the contract side).
//
//   1. LOWERCASE hex
//   2. NO `0x` prefix on the hex
//   3. timestamp as a decimal string in seconds
//
// That the separator is `|` and that the body is sha256'd then hex-encoded were both
// confirmed from source.

import { concat, getBytes, keccak256, recoverAddress, sha256, SigningKey, toUtf8Bytes } from 'ethers';

/** The fields the signature carries. No `v` — the wrapper discards it. */
export interface SealFields {
  agentId: string;
  sealId: string;
  /** Decimal string (seconds). */
  timestamp: string;
}

export interface SealSignature extends SealFields {
  r: string;
  s: string;
}

const SEPARATOR = '|';

/** `hex(sha256(body))` — lowercase, no 0x prefix (see assumptions 1-2 above). */
export function bodyHashHex(body: string): string {
  return sha256(body).slice(2).toLowerCase();
}

/** The ASCII string that gets signed. The contract rebuilds this from the fields verbatim. */
export function sealPreimage(fields: SealFields, body: string): string {
  return [fields.agentId, fields.sealId, fields.timestamp, bodyHashHex(body)].join(SEPARATOR);
}

/** The signed digest: keccak256 of the preimage string's UTF-8 bytes. NO EIP-191. */
export function sealDigest(fields: SealFields, body: string): string {
  return keccak256(toUtf8Bytes(sealPreimage(fields, body)));
}

/**
 * Sign the body with the seal key and DISCARD `v`, as the wrapper does.
 *
 * Phase 1/3 note: the key used here is not the attested enclave seal key but a local
 * binding key (P3-C will replace it with the real one). Because the format is identical,
 * the contract and the tests pass unchanged.
 */
export function signSeal(fields: SealFields, body: string, privateKey: string): SealSignature {
  const sig = new SigningKey(privateKey).sign(sealDigest(fields, body));
  return { ...fields, r: sig.r, s: sig.s };
}

/**
 * Find the signer by brute-forcing `v`.
 *
 * Because the wrapper discards `v` there are two candidates. If an expected address is
 * given, the correct one is identified; otherwise both candidates are returned
 * (`scripts/recover.js` uses this).
 */
export function recoverSealCandidates(
  fields: SealFields,
  body: string,
  r: string,
  s: string,
): Array<{ v: number; address: string }> {
  const digest = sealDigest(fields, body);
  const out: Array<{ v: number; address: string }> = [];
  for (const v of [27, 28]) {
    try {
      const signature = concat([getBytes(r), getBytes(s), new Uint8Array([v])]);
      out.push({ v, address: recoverAddress(digest, signature) });
    } catch {
      // invalid parity — skip
    }
  }
  return out;
}

/** Find the `v` that yields the expected address; null if neither does. */
export function findSealV(
  fields: SealFields,
  body: string,
  r: string,
  s: string,
  expectedSigner: string,
): number | null {
  const want = expectedSigner.toLowerCase();
  const hit = recoverSealCandidates(fields, body, r, s).find((c) => c.address.toLowerCase() === want);
  return hit ? hit.v : null;
}

/** Verify the signer: does one of the candidates yield the expected address? */
export function verifySeal(seal: SealSignature, body: string, expectedSigner: string): boolean {
  return findSealV(seal, body, seal.r, seal.s, expectedSigner) !== null;
}
