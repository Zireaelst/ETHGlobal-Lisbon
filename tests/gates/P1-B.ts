// tests/gates/P1-B.ts — ECIES katmanı kapısı.
//
// BUILD-PLAN P1-B geçiş kriterleri:
//   [ ] 200 KB'lık bir payload round-trip ediyor (gerçek dataset boyutu)
//   [ ] Yanlış private key ile çözme HATA fırlatıyor, sessizce bozuk veri dönmüyor
//   [ ] Ciphertext düz metnin hiçbir alt-dizesini içermiyor
//   [ ] Şifreleme+çözme süresi < 500 ms
//
// Ağa çıkmaz. Eksik ECIES anahtarlarını üretip .env'e yazar.

import { randomBytes } from 'node:crypto';
import {
  addressFromPublicKey,
  createEciesIdentity,
  decryptStringWith,
  decryptWith,
  eciesPublicKeyOf,
  encryptFor,
  encryptStringFor,
  toCanonicalPublicKey,
  toRawPublicKey,
} from '../../packages/shared/src/ecies.js';
import { loadDotenv, optionalEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';
import { setEnvValue } from './_env-write.js';

loadDotenv();
const gate = new Gate('P1-B', 'ECIES gizli mesajlaşma');

const LATENCY_BUDGET_MS = 500;
const PAYLOAD_BYTES = 200 * 1024;

// ---------------------------------------------------------------------------
// 1. Anahtarlar — yoksa üret ve .env'e yaz
// ---------------------------------------------------------------------------
let alicePriv = '';
let bobPriv = '';

gate.check('ALICE_ECIES_PRIV / BOB_ECIES_PRIV mevcut (yoksa üretilir)', () => {
  const lines: string[] = [];
  for (const [envKey, label] of [
    ['ALICE_ECIES_PRIV', 'Alice'],
    ['BOB_ECIES_PRIV', 'Bob'],
  ] as const) {
    let priv = optionalEnv(envKey);
    if (priv) {
      lines.push(`${label}: .env'den`);
    } else {
      priv = createEciesIdentity().privateKey;
      setEnvValue(envKey, priv);
      lines.push(`${label}: üretildi ve .env'e yazıldı`);
    }
    if (envKey === 'ALICE_ECIES_PRIV') alicePriv = priv;
    else bobPriv = priv;
  }
  if (alicePriv === bobPriv) return fail('Alice ve Bob AYNI ECIES anahtarını kullanıyor');
  return pass(lines.join('\n'));
});

gate.check('Public key kanonik biçimde ve adresle tutarlı', () => {
  const bobPub = eciesPublicKeyOf(bobPriv);
  if (!/^0x04[0-9a-fA-F]{128}$/.test(bobPub)) return fail(`kanonik değil: ${bobPub.slice(0, 20)}…`);

  // Aynı anahtarın üç gösterimi de aynı ham anahtara çözülmeli — sınırda format
  // karışıklığı olursa şifreleme sessizce başka bir alıcıya yapılabilir.
  const raw = toRawPublicKey(bobPub);
  const variants = [bobPub, raw, `04${raw}`, bobPub.toUpperCase().replace('0X', '0x')];
  const normalized = new Set(variants.map((v) => toCanonicalPublicKey(v)));
  if (normalized.size !== 1) return fail(`aynı anahtarın gösterimleri farklı normalize oldu: ${[...normalized].length}`);

  return pass(`${bobPub.slice(0, 24)}…\nadres ${addressFromPublicKey(bobPub)}`);
});

gate.check('Tanınmayan public key biçimi sessizce kabul edilmiyor', () => {
  for (const bad of ['0x', 'deadbeef', `0x04${'aa'.repeat(63)}`]) {
    try {
      toRawPublicKey(bad);
      return fail(`geçersiz anahtar kabul edildi: ${bad.slice(0, 20)}`);
    } catch {
      // beklenen
    }
  }
  return pass('kısa/bozuk anahtarlar reddediliyor');
});

// ---------------------------------------------------------------------------
// 2. 200 KB round-trip + süre
// ---------------------------------------------------------------------------
/** Gerçekçi payload: sıkıştırılabilir metin değil, gerçek dataset gibi karışık. */
const bigPayload = {
  brief: 'Analyse the attached quarterly report and flag revenue-recognition risks.',
  data: randomBytes(PAYLOAD_BYTES).toString('base64').slice(0, PAYLOAD_BYTES),
};

let elapsedMs = 0;
let bigCipher = '';

gate.check(`${PAYLOAD_BYTES / 1024} KB payload round-trip ediyor`, async () => {
  const bobPub = eciesPublicKeyOf(bobPriv);
  const t0 = Date.now();
  bigCipher = await encryptFor(bobPub, bigPayload);
  const t1 = Date.now();
  const back = await decryptWith<typeof bigPayload>(bobPriv, bigCipher);
  elapsedMs = Date.now() - t0;

  if (back.data !== bigPayload.data || back.brief !== bigPayload.brief) {
    return fail('çözülen payload gönderilenle aynı değil');
  }
  return pass(
    [
      `düz metin ${(JSON.stringify(bigPayload).length / 1024).toFixed(1)} KB`,
      `ciphertext ${(bigCipher.length / 1024).toFixed(1)} KB (hex, ~2x)`,
      `şifreleme ${t1 - t0} ms · toplam ${elapsedMs} ms`,
    ].join('\n'),
  );
});

gate.check(`Şifreleme + çözme < ${LATENCY_BUDGET_MS} ms`, () => {
  if (!elapsedMs) return fail('süre ölçülemedi');
  return elapsedMs < LATENCY_BUDGET_MS
    ? pass(`${elapsedMs} ms (bütçe ${LATENCY_BUDGET_MS} ms) — P0-G latency bütçesine bu kadar giriyor`)
    : fail(`${elapsedMs} ms — bütçe aşıldı`);
});

// ---------------------------------------------------------------------------
// 3. Yanlış anahtar / kurcalama
// ---------------------------------------------------------------------------
gate.check('Yanlış private key ile çözme HATA fırlatıyor', async () => {
  try {
    const leaked = await decryptStringWith(alicePriv, bigCipher);
    return fail(`Alice'in anahtarı Bob'un paketini çözdü (${leaked.length} byte döndü)`);
  } catch (err) {
    return pass(`hata: ${err instanceof Error ? err.message : String(err)}`);
  }
});

gate.check('Kurcalanmış ciphertext HATA fırlatıyor (bütünlük korunuyor)', async () => {
  const bobPub = eciesPublicKeyOf(bobPriv);
  const cipher = await encryptStringFor(bobPub, 'ödenecek tutar 1 USDC');
  // Tek bir hex hanesini değiştir.
  const i = cipher.length - 40;
  const ch = cipher[i] === 'a' ? 'b' : 'a';
  const tampered = `${cipher.slice(0, i)}${ch}${cipher.slice(i + 1)}`;
  if (tampered === cipher) return fail('kurcalama uygulanamadı');

  try {
    const out = await decryptStringWith(bobPriv, tampered);
    return fail(`kurcalanmış paket sessizce çözüldü: "${out.slice(0, 40)}"`);
  } catch (err) {
    return pass(`hata: ${err instanceof Error ? err.message : String(err)} — MAC bütünlüğü koruyor`);
  }
});

// ---------------------------------------------------------------------------
// 4. Sızıntı taraması
// ---------------------------------------------------------------------------
gate.check('Ciphertext düz metnin hiçbir alt-dizesini içermiyor', async () => {
  const secret = 'REVENUE-RECOGNITION-RISK-ACME-CORP-Q3-2026-CONFIDENTIAL';
  const plaintext = `${secret} ${'lorem ipsum dolor sit amet '.repeat(200)}${secret}`;
  const bobPub = eciesPublicKeyOf(bobPriv);
  const cipher = await encryptStringFor(bobPub, plaintext);

  const hits: string[] = [];

  // (a) düz metnin kendisi ciphertext string'inde geçiyor mu?
  const WINDOW = 12;
  for (let i = 0; i + WINDOW <= plaintext.length; i += WINDOW) {
    const slice = plaintext.slice(i, i + WINDOW);
    if (cipher.includes(slice)) hits.push(`düz metin parçası "${slice}"`);
    if (hits.length > 3) break;
  }

  // (b) ciphertext hex — düz metnin HEX hâli içinde geçiyor mu? (asıl risk bu)
  const plainHex = Buffer.from(plaintext, 'utf8').toString('hex');
  for (let i = 0; i + 24 <= plainHex.length; i += 24) {
    const slice = plainHex.slice(i, i + 24);
    if (cipher.toLowerCase().includes(slice)) hits.push(`hex parçası "${slice}"`);
    if (hits.length > 3) break;
  }

  return hits.length === 0
    ? pass(`${(plaintext.length / 1024).toFixed(1)} KB düz metin · 12 karakterlik ve 12 byte'lık pencerelerde sızıntı yok`)
    : fail(hits.join('\n'));
});

gate.check('Aynı düz metin iki kez şifrelenince FARKLI ciphertext üretiyor', async () => {
  // Aynı çıktı verseydi gözlemci "aynı brief yeniden gönderildi" diyebilirdi.
  const bobPub = eciesPublicKeyOf(bobPriv);
  const a = await encryptStringFor(bobPub, 'aynı mesaj');
  const b = await encryptStringFor(bobPub, 'aynı mesaj');
  return a !== b
    ? pass('her şifreleme taze IV/ephemeral anahtar kullanıyor — tekrar gönderim gözlemciye görünmez')
    : fail('iki şifreleme aynı ciphertext\'i üretti — deterministik şifreleme, tekrar sızıyor');
});

await gate.run();
