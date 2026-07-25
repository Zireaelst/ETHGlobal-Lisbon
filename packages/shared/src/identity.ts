// identity.ts — access to the ERC-8004 (Trustless Agents) IdentityRegistry.
//
// Source: github.com/erc-8004/erc-8004-contracts — abis/IdentityRegistry.json.
// The live deployment on Base Sepolia is a UUPS proxy (code size ~130 bytes;
// `upgradeToAndCall` / `proxiableUUID` / `Upgraded` are present in the ABI). The subgraph
// indexes the proxy address — it stays constant even if the implementation changes.
//
// P0-F decision (a): the registry supports ON-CHAIN key/value metadata and it can be
// updated with `setMetadata`. So skill/endpoint/eciesPubKey live directly on chain and the
// subgraph can index all of them — there is no need to fetch the agent card over HTTP.
// Details: subgraph/DECISION.md

import { Contract, type ContractRunner, Interface, toUtf8Bytes, toUtf8String } from 'ethers';

/**
 * The slice of the ABI we need.
 *
 * Note: `MetadataSet` carries FOUR fields, not three — because `keyHash` is indexed, the
 * topic holds the hash of the key, while the readable key arrives separately in the
 * non-indexed `key` field. When indexing metadata the subgraph must use the `key` field,
 * not the topic.
 */
export const IDENTITY_REGISTRY_ABI = [
  // --- registration ---
  'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)',
  'function register(string agentURI) returns (uint256 agentId)',
  'function setMetadata(uint256 agentId, string key, bytes value)',
  'function setAgentURI(uint256 agentId, string agentURI)',
  // --- reads ---
  'function getMetadata(uint256 agentId, string key) view returns (bytes)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  // --- events (the subgraph will index these) ---
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event MetadataSet(uint256 indexed agentId, string indexed keyHash, string key, bytes value)',
  'event URIUpdated(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

export const identityRegistryInterface = new Interface(IDENTITY_REGISTRY_ABI);

/** Metadata keys of an agent registration — both devs use the same names. */
export const METADATA_KEYS = {
  skill: 'skill',
  endpoint: 'endpoint',
  /** ECIES public key (0x04… uncompressed) — what Alice encrypts to. */
  eciesPubKey: 'eciesPubKey',
  /** ERC-5564 stealth meta-address (the Base privacy run, P4-B). */
  stealthMetaAddress: 'stealthMetaAddress',
  /** Hedera payment account (the agentic run, P4-C). NO recipient privacy — deliberate. */
  hederaAccount: 'hederaAccount',
  /** A field the registry adds itself during registration — we do not write it. */
  agentWallet: 'agentWallet',
} as const;

export type MetadataKey = (typeof METADATA_KEYS)[keyof typeof METADATA_KEYS];

export interface MetadataEntry {
  metadataKey: string;
  metadataValue: string; // 0x-hex
}

/** Build a UTF-8 string metadata entry. */
export function utf8Metadata(key: string, value: string): MetadataEntry {
  return { metadataKey: key, metadataValue: hexlifyUtf8(value) };
}

function hexlifyUtf8(value: string): string {
  return `0x${Buffer.from(toUtf8Bytes(value)).toString('hex')}`;
}

export function identityRegistry(address: string, runner: ContractRunner): Contract {
  return new Contract(address, IDENTITY_REGISTRY_ABI, runner);
}

/** Read metadata and UTF-8 decode it. Undefined when the field is empty. */
export async function readUtf8Metadata(
  registry: Contract,
  agentId: bigint | string,
  key: string,
): Promise<string | undefined> {
  const raw = (await registry.getFunction('getMetadata')(agentId, key)) as string;
  if (!raw || raw === '0x') return undefined;
  return toUtf8String(raw);
}

/**
 * Read metadata, retrying until the expected value appears.
 *
 * The Base Sepolia public RPC is load-balanced: a read issued immediately after `tx.wait()`
 * returns can land on a replica that has not yet seen the write (we hit this live in P0-F —
 * the read returned the previous run's value). The proof of the write is the transaction's
 * own `MetadataSet` event; this function only waits for read consistency.
 */
export async function readUtf8MetadataUntil(
  registry: Contract,
  agentId: bigint | string,
  key: string,
  expected: string,
  { tries = 15, delayMs = 1000 } = {},
): Promise<string | undefined> {
  let last: string | undefined;
  for (let i = 0; i < tries; i++) {
    last = await readUtf8Metadata(registry, agentId, key);
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}
