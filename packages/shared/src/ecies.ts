// ecies.ts — gizli mesajlaşma katmanı (BUILD-PLAN P1-B).
//
// `eth-crypto` sarmalayıcı. Şifreli paket tel üzerinde `EthCrypto.cipher.stringify`
// formatında (tek hex string) taşınır.
//
// ANAHTAR FORMATI — iki farklı gösterim var, karıştırmak sessiz hataya yol açar:
//   - eth-crypto public key: 0x ÖNEKSİZ 128 hex hane (04 öneki de yok).
//   - Bizim tel/registry formatımız: 0x04 + 128 hex (standart SEC1 uncompressed).
// ERC-8004'e `eciesPubKey` olarak KANONİK biçim yazılır; bu modül sınırda çevirir.
// Karşılaştırmalar daima kanonik biçim üzerinden yapılmalı.
//
// Gizlilik sınırı (CLAUDE.md §11): bu katman içeriği gizler. Kimin kiminle konuştuğu
// (endpoint, IP, zamanlama) gizlenmez — onun cevabı stealth ödeme, bu değil.

import EthCryptoDefault from 'eth-crypto';
import { computeAddress } from 'ethers';

// eth-crypto CJS/ESM köprüsü: `default` altında da gelebiliyor.
const EthCrypto = (EthCryptoDefault as unknown as { default?: typeof EthCryptoDefault }).default ?? EthCryptoDefault;

export interface EciesIdentity {
  /** 0x + 64 hex. */
  privateKey: string;
  /** Kanonik biçim: 0x04 + 128 hex. */
  publicKey: string;
  address: string;
}

const RAW_PUBKEY = /^[0-9a-fA-F]{128}$/;
const CANONICAL_PUBKEY = /^0x04[0-9a-fA-F]{128}$/;

/** Herhangi bir kabul edilen gösterimden eth-crypto'nun beklediği ham 128 hex'e. */
export function toRawPublicKey(publicKey: string): string {
  const v = publicKey.trim();
  if (RAW_PUBKEY.test(v)) return v.toLowerCase();
  if (CANONICAL_PUBKEY.test(v)) return v.slice(4).toLowerCase();
  if (/^04[0-9a-fA-F]{128}$/.test(v)) return v.slice(2).toLowerCase();
  throw new Error(
    `ECIES public key biçimi tanınmadı (uzunluk ${v.length}). Beklenen: 0x04+128 hex, 04+128 hex ya da çıplak 128 hex.`,
  );
}

/** Kanonik biçim: 0x04 + 128 hex. Registry'ye ve agent card'a bu yazılır. */
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
    throw new Error('ECIES private key 0x + 64 hex hane olmalı');
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

/** Public key'in ima ettiği EVM adresi — kayıt ile anahtarın eşleştiğini doğrulamak için. */
export function addressFromPublicKey(publicKey: string): string {
  return computeAddress(toCanonicalPublicKey(publicKey));
}

/** Ham string'i şifrele. */
export async function encryptStringFor(publicKey: string, plaintext: string): Promise<string> {
  const encrypted = await EthCrypto.encryptWithPublicKey(toRawPublicKey(publicKey), plaintext);
  return EthCrypto.cipher.stringify(encrypted);
}

/**
 * Şifreyi çöz.
 *
 * Yanlış anahtar ya da kurcalanmış ciphertext `Bad MAC` ile PATLAR — sessizce bozuk
 * veri dönmez. Bu davranış kapı kriteridir (P1-B), tesadüf değil: gövde bütünlüğü
 * intent-binding'in altındaki varsayım.
 */
export async function decryptStringWith(privateKey: string, cipher: string): Promise<string> {
  const parsed = EthCrypto.cipher.parse(cipher);
  return EthCrypto.decryptWithPrivateKey(normalizePrivateKey(privateKey), parsed);
}

/** Nesneyi JSON'a çevirip şifrele. */
export async function encryptFor(publicKey: string, payload: unknown): Promise<string> {
  return encryptStringFor(publicKey, JSON.stringify(payload));
}

/** Çöz ve JSON'u parse et. Şema doğrulaması ÇAĞIRANIN işi (schema.ts parseOrThrow). */
export async function decryptWith<T = unknown>(privateKey: string, cipher: string): Promise<T> {
  return JSON.parse(await decryptStringWith(privateKey, cipher)) as T;
}
