// identity.ts — ERC-8004 (Trustless Agents) IdentityRegistry erişimi.
//
// Kaynak: github.com/erc-8004/erc-8004-contracts — abis/IdentityRegistry.json.
// Base Sepolia'daki canlı deployment bir UUPS proxy'dir (kod boyutu ~130 byte;
// `upgradeToAndCall` / `proxiableUUID` / `Upgraded` ABI'de var). Subgraph proxy
// adresini indeksler — implementasyon değişse de adres sabit kalır.
//
// P0-F kararı (a): registry ON-CHAIN key/value metadata destekliyor ve `setMetadata`
// ile güncellenebiliyor. Yani skill/endpoint/eciesPubKey doğrudan zincirde durur ve
// subgraph hepsini indeksleyebilir — agent card'ı HTTP'den çekmeye gerek yok.
// Ayrıntı: subgraph/DECISION.md

import { Contract, type ContractRunner, Interface, toUtf8Bytes, toUtf8String } from 'ethers';

/**
 * İhtiyacımız olan ABI dilimi.
 *
 * Not: `MetadataSet` üç değil DÖRT alan taşır — `keyHash` indexed olduğu için topic'te
 * anahtarın hash'i durur, okunabilir anahtar ise ayrıca non-indexed `key` alanında gelir.
 * Subgraph metadata'yı indekslerken `key` alanını kullanmalı, topic'i değil.
 */
export const IDENTITY_REGISTRY_ABI = [
  // --- kayıt ---
  'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)',
  'function register(string agentURI) returns (uint256 agentId)',
  'function setMetadata(uint256 agentId, string key, bytes value)',
  'function setAgentURI(uint256 agentId, string agentURI)',
  // --- okuma ---
  'function getMetadata(uint256 agentId, string key) view returns (bytes)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  // --- event'ler (subgraph bunları indeksleyecek) ---
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event MetadataSet(uint256 indexed agentId, string indexed keyHash, string key, bytes value)',
  'event URIUpdated(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

export const identityRegistryInterface = new Interface(IDENTITY_REGISTRY_ABI);

/** Bir agent kaydının metadata anahtarları — iki dev de aynı isimleri kullanır. */
export const METADATA_KEYS = {
  skill: 'skill',
  endpoint: 'endpoint',
  /** ECIES public key (0x04… uncompressed) — Alice bununla şifreler. */
  eciesPubKey: 'eciesPubKey',
  /** ERC-5564 stealth meta-address (Base gizlilik koşusu, P4-B). */
  stealthMetaAddress: 'stealthMetaAddress',
  /** Registry'nin kayıt sırasında kendi eklediği alan — biz yazmıyoruz. */
  agentWallet: 'agentWallet',
} as const;

export type MetadataKey = (typeof METADATA_KEYS)[keyof typeof METADATA_KEYS];

export interface MetadataEntry {
  metadataKey: string;
  metadataValue: string; // 0x-hex
}

/** UTF-8 string metadata girdisi kur. */
export function utf8Metadata(key: string, value: string): MetadataEntry {
  return { metadataKey: key, metadataValue: hexlifyUtf8(value) };
}

function hexlifyUtf8(value: string): string {
  return `0x${Buffer.from(toUtf8Bytes(value)).toString('hex')}`;
}

export function identityRegistry(address: string, runner: ContractRunner): Contract {
  return new Contract(address, IDENTITY_REGISTRY_ABI, runner);
}

/** Metadata'yı oku ve UTF-8 çöz. Alan boşsa undefined. */
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
 * Metadata'yı okur, beklenen değere ulaşana kadar yeniden dener.
 *
 * Base Sepolia public RPC'si yük dengeli: `tx.wait()` döndükten hemen sonra yapılan bir
 * okuma, yazmayı henüz görmemiş bir replikaya düşebiliyor (P0-F'te canlı olarak yaşandı —
 * okuma bir önceki koşunun değerini döndürdü). Yazmanın kanıtı işlemin kendi
 * `MetadataSet` event'idir; bu fonksiyon yalnızca okuma tutarlılığını bekler.
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
