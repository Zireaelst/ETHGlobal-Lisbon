// canonical.ts — the antidote to hash mismatch (BUILD-PLAN §2.3).
//
// The place two developers lose the most time is serialising the same data
// differently and producing different hashes. One rule: keys sorted, no whitespace,
// `undefined` dropped.
//
// This function runs ONLY on the TypeScript side — Solidity does not parse JSON.
// The contract receives `constraintsHash` as a ready-made bytes32 (see intent.ts),
// so the determinism here is not cross-language: it is needed between the two agent
// processes.

import { keccak256, toUtf8Bytes } from 'ethers';

/**
 * Deterministic JSON: object keys in lexicographic order, no whitespace at all,
 * `undefined` fields dropped (inside an array they become `null` — JSON.stringify
 * behaviour).
 *
 * Unsupported types throw LOUDLY rather than silently producing a different hash.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, new WeakSet());
}

function serialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: ${value} cannot be serialised (NaN/Infinity silently corrupts the hash)`);
      }
      return JSON.stringify(value);
    case 'bigint':
      // 1n and "1" must not produce the same hash; the caller has to choose explicitly.
      throw new TypeError(
        'canonicalJson: bigint is not supported — convert to a decimal string first (the 1n vs "1" distinction produces a silent hash difference)',
      );
    case 'undefined':
      throw new TypeError('canonicalJson: undefined cannot be serialised at the root');
    case 'function':
    case 'symbol':
      throw new TypeError(`canonicalJson: ${typeof value} cannot be serialised`);
  }

  const obj = value as object;
  if (seen.has(obj)) throw new TypeError('canonicalJson: circular reference');
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items = obj.map((item) => (item === undefined ? 'null' : serialize(item, seen)));
      return `[${items.join(',')}]`;
    }
    const entries = Object.keys(obj as Record<string, unknown>)
      .sort()
      .map((key) => [key, (obj as Record<string, unknown>)[key]] as const)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => `${JSON.stringify(key)}:${serialize(v, seen)}`);
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

/** keccak256 of a UTF-8 string. Brief and data are hashed as RAW strings with this. */
export const hashUtf8 = (s: string): string => keccak256(toUtf8Bytes(s));

/** keccak256 of the object's canonical JSON. Constraints are hashed with this. */
export const hashCanonical = (v: unknown): string => hashUtf8(canonicalJson(v));
