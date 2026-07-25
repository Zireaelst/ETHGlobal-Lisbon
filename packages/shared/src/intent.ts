// intent.ts — intentHash taahhüdü + Alice'in EIP-712 imzası (BUILD-PLAN §2.3).
//
//   intentHash = keccak256(abi.encode(
//     bytes32 briefHash,        // hashUtf8(brief)
//     bytes32 dataHash,         // hashUtf8(data)
//     bytes32 constraintsHash,  // hashUtf8(canonicalJson(constraints))
//     uint256 price,            // en küçük birim (USDC: 6 hane, HBAR: tinybar)
//     uint256 nonce
//   ))
//
// abi.encode — encodePacked DEĞİL. Packed kullanmak TS ile Solidity arasında sessiz
// uyuşmazlık üretir (BUILD-PLAN P1-A ⛔ notu); ayrıca packed'de bitişik dinamik alanlar
// birbirine karışabilir. Sabit 5×32 byte istiyoruz.
//
// Tasarım notu (§2.3): Alice içeriği DEĞİL, `intentHash` taahhüdünü imzalar.
// `agentId` yapının içinde, yoksa aynı imza başka bir worker'a replay edilebilir.
// `price` içinde çünkü settlement onu okuyor. `deadline` içinde çünkü süresi geçmiş
// intent kabul edilmemeli.

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

/** İşin teknik kısıtları. Anahtar sırası önemsiz — canonicalJson sıralıyor. */
export interface Constraints {
  model: string;
  maxTokens: number;
  temperature: number;
  [extra: string]: unknown;
}

/** intentHash'i oluşturan ham girdiler. */
export interface IntentInputs {
  brief: string;
  data: string;
  constraints: Constraints;
  /** En küçük birim (USDC 6 hane, HBAR tinybar). */
  price: bigint;
  nonce: bigint;
}

/** Alice'in EIP-712 ile imzaladığı yapı. */
export interface Intent {
  intentHash: string;
  client: string;
  /** ERC-8004 agentId'si bytes32'ye sağa hizalı doldurulmuş hâli. */
  agentId: string;
  price: bigint;
  deadline: bigint;
}

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
 * EIP-712 domain'i. `verifyingContract` zorunlu ve AÇIK — varsayılan vermiyoruz,
 * çünkü yanlış (ör. sıfır) adresle imzalanan bir intent kontrat tarafında sessizce
 * doğrulanamaz hâle gelir ve hata P3-D'de ortaya çıkar.
 */
export function intentDomain(verifyingContract: string, chainId: number = BASE_SEPOLIA_CHAIN_ID): TypedDataDomain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: getAddress(verifyingContract),
  };
}

/** ERC-8004 sayısal agentId'sini (ör. 8429n) bytes32'ye çevir. */
export function agentIdToBytes32(agentId: bigint | number | string): string {
  return zeroPadValue(toBeHex(BigInt(agentId)), 32);
}

/**
 * §2.3'teki 5 alanlı taahhüt. Aynı girdi her zaman aynı çıktıyı verir —
 * `Date.now()` benzeri hiçbir örtük girdi yok.
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

/** Ara hash'ler — hata ayıklarken hangi alanın uyuşmadığını görmek için. */
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

/** Alice intent'i EIP-712 ile imzalar. */
export async function signIntent(
  intent: Intent,
  signer: Signer,
  verifyingContract: string,
  chainId: number = BASE_SEPOLIA_CHAIN_ID,
): Promise<string> {
  return signer.signTypedData(intentDomain(verifyingContract, chainId), INTENT_TYPES, intent);
}

/**
 * İmzayı atan adresi geri kurtar.
 *
 * Kontrat da tam olarak bunu yapar: imza+intent çiftini Bob verse bile imzacıyı
 * yapının KENDİ alanlarından yeniden üretilen digest üzerinden bulur (§2.3, P3-A adım 3).
 */
export function recoverIntentSigner(
  intent: Intent,
  signature: string,
  verifyingContract: string,
  chainId: number = BASE_SEPOLIA_CHAIN_ID,
): string {
  return verifyTypedData(intentDomain(verifyingContract, chainId), INTENT_TYPES, intent, signature);
}
