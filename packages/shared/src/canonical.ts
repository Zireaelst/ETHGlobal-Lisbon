// canonical.ts — hash uyuşmazlığının panzehiri (BUILD-PLAN §2.3).
//
// İki geliştiricinin en çok zaman kaybettiği yer, aynı veriyi farklı serileştirip
// farklı hash üretmektir. Kural tek: anahtarlar sıralı, boşluk yok, `undefined` atılır.
//
// Bu fonksiyon YALNIZCA TypeScript tarafında çalışır — Solidity JSON parse etmez.
// Kontrat `constraintsHash`'i hazır bytes32 olarak alır (bkz. intent.ts), o yüzden
// buradaki determinizm diller arası değil, iki agent süreci arasında gereklidir.

import { keccak256, toUtf8Bytes } from 'ethers';

/**
 * Deterministik JSON: nesne anahtarları sözlük sırasına göre, hiç boşluk yok,
 * `undefined` alanlar atılır (dizi içinde `null` olur — JSON.stringify davranışı).
 *
 * Desteklenmeyen tipler sessizce farklı hash üretmesin diye AÇIKÇA patlar.
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
        throw new TypeError(`canonicalJson: ${value} serileştirilemez (NaN/Infinity hash'i sessizce bozar)`);
      }
      return JSON.stringify(value);
    case 'bigint':
      // 1n ile "1" aynı hash'i üretmemeli; çağıranın hangisini istediğini açıkça seçmesi gerekir.
      throw new TypeError(
        'canonicalJson: bigint desteklenmiyor — decimal string\'e çevirip öyle verin (1n vs "1" ayrımı sessiz hash farkı üretir)',
      );
    case 'undefined':
      throw new TypeError('canonicalJson: kök seviyede undefined serileştirilemez');
    case 'function':
    case 'symbol':
      throw new TypeError(`canonicalJson: ${typeof value} serileştirilemez`);
  }

  const obj = value as object;
  if (seen.has(obj)) throw new TypeError('canonicalJson: döngüsel referans');
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

/** UTF-8 string'in keccak256'sı. Brief ve data HAM string olarak bununla hash'lenir. */
export const hashUtf8 = (s: string): string => keccak256(toUtf8Bytes(s));

/** Nesnenin kanonik JSON'unun keccak256'sı. Constraints bununla hash'lenir. */
export const hashCanonical = (v: unknown): string => hashUtf8(canonicalJson(v));
