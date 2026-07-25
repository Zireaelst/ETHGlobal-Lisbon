// sealsig.ts — Tapp seal imzası: preimage kurma + imzalama + v brute-force ile recover.
//
// KAYNAK: CLAUDE.md §3.1(B) — `agent-wrapper` kaynağından çıkarılmış şema:
//
//   digest = keccak256( "agentId|sealId|timestamp|hex(sha256(body))" )
//   imza   = secp256k1, 64-byte R‖S, **v ATILMIŞ**, **EIP-191 ÖNEKİ YOK**
//
// Gövde önce `sha256`'lanır, hex'lenir, boru işaretiyle birleştirilen ASCII string'e
// katılır, sonra o string'in `keccak256`'sı imzalanır. Yani iki farklı hash primitifi
// arka arkaya kullanılıyor — karıştırmak sessiz uyuşmazlık üretir.
//
// ⚠️ DOĞRULANMAMIŞ SERBESTLİK DERECELERİ (BUILD-PLAN U1/U2, P0-C kapatacak):
// Aşağıdaki üç seçim şu an VARSAYIM. Canlı bir Tapp imzası yakalanınca
// `scripts/recover.js` doğru varyantı bulacak ve DEĞİŞECEK TEK YER burasıdır
// (kontrat tarafında da `Verifier._sealDigest`).
//
//   1. hex KÜÇÜK harf
//   2. hex'te `0x` öneki YOK
//   3. timestamp saniye cinsinden ondalık string
//
// Ayırıcının `|` olduğu ve gövdenin sha256'lanıp hex'lendiği kaynaktan doğrulandı.

import { concat, getBytes, keccak256, recoverAddress, sha256, SigningKey, toUtf8Bytes } from 'ethers';

/** İmzanın taşındığı alanlar. `v` yok — wrapper onu atıyor. */
export interface SealFields {
  agentId: string;
  sealId: string;
  /** Ondalık string (saniye). */
  timestamp: string;
}

export interface SealSignature extends SealFields {
  r: string;
  s: string;
}

const SEPARATOR = '|';

/** `hex(sha256(body))` — küçük harf, 0x öneksiz (bkz. yukarıdaki varsayım 1-2). */
export function bodyHashHex(body: string): string {
  return sha256(body).slice(2).toLowerCase();
}

/** İmzalanan ASCII string. Kontrat bunu alanlardan birebir yeniden üretir. */
export function sealPreimage(fields: SealFields, body: string): string {
  return [fields.agentId, fields.sealId, fields.timestamp, bodyHashHex(body)].join(SEPARATOR);
}

/** İmzalanan digest: preimage string'inin UTF-8 byte'larının keccak256'sı. EIP-191 YOK. */
export function sealDigest(fields: SealFields, body: string): string {
  return keccak256(toUtf8Bytes(sealPreimage(fields, body)));
}

/**
 * Gövdeyi seal anahtarıyla imzala ve wrapper gibi `v`'yi AT.
 *
 * FAZ 1/3 notu: burada kullanılan anahtar attested enclave seal key'i değil, yerel
 * binding anahtarıdır (P3-C gerçeğiyle değiştirecek). Format aynı olduğu için
 * kontrat ve testler değişmeden geçer.
 */
export function signSeal(fields: SealFields, body: string, privateKey: string): SealSignature {
  const sig = new SigningKey(privateKey).sign(sealDigest(fields, body));
  return { ...fields, r: sig.r, s: sig.s };
}

/**
 * `v` brute-force ederek imzacıyı bul.
 *
 * Wrapper `v`'yi attığı için iki aday var. Beklenen adres verilirse hangisinin doğru
 * olduğu belirlenir; verilmezse iki aday da döner (`scripts/recover.js` bunu kullanır).
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
      // geçersiz parite — atla
    }
  }
  return out;
}

/** Beklenen adresi veren `v`'yi bul; hiçbiri vermiyorsa null. */
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

/** İmzacıyı doğrula: adaylardan biri beklenen adresi veriyor mu? */
export function verifySeal(seal: SealSignature, body: string, expectedSigner: string): boolean {
  return findSealV(seal, body, seal.r, seal.s, expectedSigner) !== null;
}
