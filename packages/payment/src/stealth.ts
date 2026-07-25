// stealth.ts — ERC-5564 stealth adres türetmesi (scheme 1: secp256k1 + view tag).
//
// Amaç: Bob'un kayıtlı kimliği herkese açıkken, ona yapılan ödemenin o kimliğe
// BAĞLANAMAMASI. Bob bir "meta-adres" yayınlar; Alice her iş için ondan TAZE bir
// adres türetir. Zincirde "bir adres USDC aldı" görünür, o adresin Bob olduğu
// görünmez.
//
// Şema (ERC-5564 §scheme 1):
//   Bob:   k = harcama anahtarı, v = görüntüleme anahtarı
//          meta-adres = "st:<chain>:0x" + compressed(K) + compressed(V)
//   Alice: r = geçici (ephemeral) anahtar,  R = r·G
//          S     = compressed(r·V)                 ← paylaşılan sır
//          s_h   = keccak256(S)
//          P     = K + s_h·G                       ← stealth public key
//          adres = address(P),  viewTag = s_h[0]
//   Bob:   S = compressed(v·R) → aynı s_h
//          p = (k + s_h) mod n                     ← stealth PRIVATE key
//
// `viewTag` taramayı ucuzlatıyor: Bob her duyuru için tam türetme yapmak yerine
// önce tek byte karşılaştırıyor (255/256 duyuruyu erken eliyor).
//
// KRİTİK: "adres ürettik" hiçbir şey kanıtlamaz. Kanıt, Bob'un o adresten
// HARCAYABİLMESİDİR — gate:P4-B fonu gerçekten çıkararak test ediyor.

import { SigningKey, computeAddress, getBytes, hexlify, keccak256, toUtf8Bytes } from 'ethers';

/** secp256k1 grup mertebesi. */
const CURVE_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

/** ERC-5564 scheme 1 = secp256k1, view tag'li. */
export const SCHEME_ID = 1n;

export interface StealthKeys {
  /** Harcama anahtarı — parayı hareket ettiren. */
  spendingPrivateKey: string;
  /** Görüntüleme anahtarı — "bu bana mı?" taramasını yapan. Harcama YETKİSİ YOK. */
  viewingPrivateKey: string;
  spendingPublicKey: string;
  viewingPublicKey: string;
  /** "st:base:0x<K><V>" */
  metaAddress: string;
}

export interface StealthPayment {
  /** Alice'in ödeyeceği taze adres. */
  stealthAddress: string;
  /** Duyuruda yayınlanan geçici public key (compressed). */
  ephemeralPublicKey: string;
  /** Taramayı ucuzlatan tek byte. */
  viewTag: number;
  /** ERC-5564 Announcer'a gidecek metadata (ilk byte = view tag). */
  metadata: string;
}

function assertPriv(key: string, what: string): string {
  const v = key.startsWith('0x') ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`stealth: ${what} 0x + 64 hex hane olmalı`);
  return v;
}

/** Bob'un meta-adresini üret. İki AYRI anahtar — görüntüleme harcama yetkisi vermez. */
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
      `stealth: meta-adres biçimi tanınmadı. Beklenen "st:<chain>:0x<66 hex><66 hex>" (iki compressed pubkey).`,
    );
  }
  return { chain: m[1]!, spendingPublicKey: `0x${m[2]}`, viewingPublicKey: `0x${m[3]}` };
}

/** Paylaşılan sırdan türeyen skaler: s_h = keccak256(compressed(shared)). */
function sharedScalar(privateKey: string, publicKey: string): string {
  const shared = new SigningKey(privateKey).computeSharedSecret(publicKey);
  // ERC-5564 SIKIŞTIRILMIŞ noktayı hash'liyor — sıkıştırmamak sessizce başka bir
  // adres üretir ve Bob parayı bulamaz.
  return keccak256(SigningKey.computePublicKey(shared, true));
}

/** address(P + s_h·G) — hem Alice hem Bob tarafında aynı sonucu vermeli. */
function stealthAddressFrom(spendingPublicKey: string, scalar: string): string {
  const scalarPoint = SigningKey.computePublicKey(scalar, true);
  const stealthPub = SigningKey.addPoints(spendingPublicKey, scalarPoint, false);
  return computeAddress(stealthPub);
}

/**
 * ALICE: meta-adresten taze bir stealth adres türet.
 *
 * `ephemeralPrivateKey` testler için verilebilir; üretimde her ödeme için TAZE
 * ve rastgele olmalı — tekrar kullanmak iki ödemeyi birbirine bağlar.
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
 * BOB: bir duyuru bana mı ait?
 *
 * Önce view tag'e bakar (tek byte, ucuz); tutarsa tam türetmeyi yapar.
 * Yalnızca GÖRÜNTÜLEME anahtarı gerekir — harcama anahtarı bu adımda kullanılmaz.
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
 * BOB: stealth adresin PRIVATE key'ini türet — parayı hareket ettiren şey bu.
 *
 * p = (k + s_h) mod n. Modülo almayı atlamak nadiren (k + s_h >= n olduğunda)
 * geçersiz anahtar üretir; o durumda para kurtarılamaz.
 */
export function computeStealthPrivateKey(
  keys: Pick<StealthKeys, 'spendingPrivateKey' | 'viewingPrivateKey'>,
  ephemeralPublicKey: string,
): string {
  const scalar = sharedScalar(keys.viewingPrivateKey, ephemeralPublicKey);
  const k = BigInt(keys.spendingPrivateKey);
  const sum = (k + BigInt(scalar)) % CURVE_ORDER;
  if (sum === 0n) throw new Error('stealth: türetilen anahtar sıfır — geçersiz');
  return `0x${sum.toString(16).padStart(64, '0')}`;
}

/**
 * Bir agent'ın stealth anahtarlarını kök cüzdan anahtarından DETERMİNİSTİK türet.
 *
 * Böylece meta-adres her koşuda aynı çıkıyor (demo tekrarlanabilir) ve ayrı bir sır
 * saklamak gerekmiyor. Harcama ve görüntüleme anahtarları FARKLI etiketlerden
 * türetiliyor: görüntüleme anahtarı sızsa bile para harcanamaz.
 */
export function deriveAgentStealthKeys(rootPrivateKey: string, label = 'bob', chain = 'base'): StealthKeys {
  return createStealthKeys(
    keccak256(toUtf8Bytes(`stealth/spending/${label}/${rootPrivateKey}`)),
    keccak256(toUtf8Bytes(`stealth/viewing/${label}/${rootPrivateKey}`)),
    chain,
  );
}

export { CURVE_ORDER };
