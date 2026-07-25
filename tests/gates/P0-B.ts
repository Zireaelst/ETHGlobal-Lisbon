// tests/gates/P0-B.ts — 0G Sealed Inference kapısı (HERO RİSKİ).
//
// BUILD-PLAN P0-B geçiş kriterleri:
//   [ ] Sağlayıcı `TeeML` olarak listeleniyor
//   [ ] `processResponse` → valid === true
//   [ ] `verifyMessage` broker'ın verdiği signer'a eşit (SDK'ya değil, KENDİ kodumuza güveniyoruz)
//   [ ] Fixture diskte, ağa çıkmadan replay ediliyor
//   [ ] Tek çağrının duvar-saati süresi kaydedildi (P0-G bütçesi bu)
//
// Kapı AĞA ÇIKMIYOR: `scripts/og-spike.ts` bir kez koşup fixture üretir, kapı onu
// doğrular. Sebebi BUILD-PLAN §0 kural 4 — her gerçek 0G çağrısı para harcıyor,
// kapı her koşuşta ödeme yapamaz. Zincire bakan tek kriter sağlayıcının canlı
// `teeSignerAcknowledged` bayrağı (salt okunur, ücretsiz).

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { loadDotenv, optionalEnv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const root = repoRoot();
const gate = new Gate('P0-B', '0G Sealed Inference — TEE imzası yakalandı ve BAĞIMSIZ doğrulandı');

const SIGNER_FIXTURE = resolve(root, 'fixtures/og/signer.json');
const RUN_FIXTURE = resolve(root, 'fixtures/og/run-1.json');

/** P0-G bütçesi 60 sn; tek çağrı bunun makul bir dilimini aşmamalı. */
const SINGLE_CALL_BUDGET_MS = 30_000;

type SignerFixture = {
  provider: string;
  model: string;
  url: string;
  verifiability: string;
  teeSignerAddress: string;
  expectedSigner: string;
  targetSeparated: boolean;
  providerType: string;
  isAcknowledged: boolean;
};

type RunFixture = {
  request: { endpoint: string; model: string; prompt: string };
  rawResponseText: string;
  output: string;
  latencyMs: number;
  chatID: string;
  signature: { text: string; signature: string };
  verification: {
    sdkProcessResponse: boolean | null;
    independentRecovered: string;
    expectedSigner: string;
    independentValid: boolean;
    signedTextCoversOutput: boolean;
    scheme: string;
    signedTuple: string;
    signedTupleParts: string[];
    responseSha256: string;
    responseDigestIndexInTuple: number;
  };
};

const readFixture = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

// ---------------------------------------------------------------------------
// 1. Fixture'lar var mı
// ---------------------------------------------------------------------------
gate.check('Fixture diskte (fixtures/og/signer.json + run-1.json)', () => {
  const missing = [SIGNER_FIXTURE, RUN_FIXTURE].filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return fail(
      `eksik: ${missing.map((m) => m.replace(root, '.')).join(', ')}\n` +
        'üretmek için: npx tsx scripts/og-spike.ts (PARA HARCAR)',
    );
  }
  const signer = readFixture<SignerFixture>(SIGNER_FIXTURE);
  const run = readFixture<RunFixture>(RUN_FIXTURE);
  return pass(`sağlayıcı ${signer.provider} · model ${signer.model} · ${run.rawResponseText.length} bayt yanıt`);
});

// ---------------------------------------------------------------------------
// 2. TeeML — TeeTLS kabul edilmez
// ---------------------------------------------------------------------------
gate.check('Sağlayıcı TeeML olarak listeleniyor (TeeTLS KABUL EDİLMEZ)', () => {
  const signer = readFixture<SignerFixture>(SIGNER_FIXTURE);
  if (signer.verifiability !== 'TeeML') {
    return fail(
      `verifiability="${signer.verifiability}" — "altyapı veriyi göremez" iddiamız TeeML'e dayanıyor. ` +
        'TeeTLS sadece taşımayı şifreler, model normal makinede koşar.',
    );
  }
  return pass(`verifiability=TeeML · ${signer.model}`);
});

// ---------------------------------------------------------------------------
// 3. Onay bayrağı — CANLI zincirden
// ---------------------------------------------------------------------------
gate.check('Sağlayıcının TEE signer\'ı kontratta ONAYLI (canlı okuma)', async () => {
  const signer = readFixture<SignerFixture>(SIGNER_FIXTURE);
  const require_ = createRequire(import.meta.url);
  // SDK v0.9.0 ESM build'i kırık → CJS (bkz. scripts/og-list.ts).
  const { createZGComputeNetworkBroker } = require_('@0gfoundation/0g-compute-ts-sdk');

  const provider = new ethers.JsonRpcProvider(requireEnv('OG_RPC_URL'));
  const wallet = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  // checkProviderSignerStatus() ÇAĞIRMIYORUZ: o fonksiyon alt hesap yoksa
  // 1 OG transfer ediyor. Struct'tan okumak ücretsiz.
  const services = Array.from(
    await broker.inference.listService(0, 50, true),
  ) as Array<{ provider: string; teeSignerAcknowledged: boolean; teeSignerAddress: string }>;

  const live = services.find((s) => s.provider.toLowerCase() === signer.provider.toLowerCase());
  if (!live) return fail(`sağlayıcı ${signer.provider} artık listede yok`);
  if (!live.teeSignerAcknowledged) {
    return fail(
      'teeSignerAcknowledged=false — kontrat sahibi bu sağlayıcının TEE signer\'ına kefil olmamış. ' +
        'Bu haldeyken teeSignerAddress sağlayıcının kendi beyanıdır ve processResponse false döner.',
    );
  }
  if (live.teeSignerAddress.toLowerCase() !== signer.teeSignerAddress.toLowerCase()) {
    return fail(
      `TEE signer DEĞİŞMİŞ: fixture ${signer.teeSignerAddress}, canlı ${live.teeSignerAddress} — ` +
        'spike yeniden koşulmalı',
    );
  }
  return pass(`onaylı · signer ${live.teeSignerAddress} fixture ile aynı`);
});

// ---------------------------------------------------------------------------
// 4. SDK'nın kendi doğrulaması
// ---------------------------------------------------------------------------
gate.check('SDK processResponse → true', () => {
  const run = readFixture<RunFixture>(RUN_FIXTURE);
  return run.verification.sdkProcessResponse === true
    ? pass('broker.inference.processResponse() true döndü')
    : fail(`processResponse ${run.verification.sdkProcessResponse} döndü`);
});

// ---------------------------------------------------------------------------
// 5. BİZİM doğrulamamız — ağa çıkmadan, sıfırdan
// ---------------------------------------------------------------------------
gate.check('İmza KENDİ kodumuzla kurtarıldı ve signer\'a eşit (SDK\'ya güvenmiyoruz)', () => {
  const signer = readFixture<SignerFixture>(SIGNER_FIXTURE);
  const run = readFixture<RunFixture>(RUN_FIXTURE);

  // Fixture'daki sonuca değil, imzanın kendisine bakıyoruz: baştan kurtarıyoruz.
  const recovered = ethers.verifyMessage(run.signature.text, run.signature.signature);
  if (recovered.toLowerCase() !== signer.expectedSigner.toLowerCase()) {
    return fail(`kurtarılan ${recovered}, beklenen ${signer.expectedSigner}`);
  }
  if (recovered.toLowerCase() !== run.verification.independentRecovered.toLowerCase()) {
    return fail('fixture\'daki kurtarılmış adres şimdi hesaplananla tutmuyor — fixture bozulmuş');
  }
  return pass(
    [
      `kurtarılan ${recovered} === beklenen ${signer.expectedSigner}`,
      'şema: EIP-191 (ethers.verifyMessage) — ağa çıkılmadı',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 6. İmza NEYİ kapsıyor — CLAUDE.md §3.1 düzeltmesi
// ---------------------------------------------------------------------------
gate.check('İmzalanan demet, ham yanıt gövdesinin sha256\'sını içeriyor', () => {
  const run = readFixture<RunFixture>(RUN_FIXTURE);

  // CLAUDE.md §3.1 "imza ÇIKTI metnini kapsar" diyor — bu sağlayıcıda YANLIŞ.
  // İmzalanan metin: "<h1>:<sha256(gövde)>:<ProviderType>:<ProviderIdentity>:<h3>"
  // Çıktının imza kapsamında olduğunu söyleyebilmemizin TEK dayanağı bu eşitlik,
  // o yüzden fixture'a güvenmeyip ham gövdeden yeniden hesaplıyoruz.
  const digest = createHash('sha256').update(run.rawResponseText).digest('hex');
  const parts = run.signature.text.split(':');
  const idx = parts.indexOf(digest);

  if (idx === -1) {
    return fail(
      'imzalı demet sha256(ham yanıt) içermiyor → imza çıktıya bağlı değil.\n' +
        `demet : ${run.signature.text}\nsha256: ${digest}`,
    );
  }

  // Çıktı gerçekten o gövdenin içinden mi geliyor?
  if (!run.rawResponseText.includes(JSON.stringify(run.output).slice(1, 60))) {
    return fail('kaydedilen çıktı ham gövdenin içinde bulunamadı — fixture tutarsız');
  }

  return pass(
    [
      `sha256(ham yanıt) = ${digest}`,
      `demette #${idx}. parça olarak bulundu (${parts.length} parça)`,
      'çıktı bu gövdenin içinde → imza çıktıya BAĞLI',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 7. Kurcalama tespiti
// ---------------------------------------------------------------------------
gate.check('Yanıt tek bayt değişse imza tutmuyor', () => {
  const run = readFixture<RunFixture>(RUN_FIXTURE);
  const original = createHash('sha256').update(run.rawResponseText).digest('hex');

  // Tek karakter değiştir — özet değişmeli ve demette artık bulunmamalı.
  const tampered = `${run.rawResponseText.slice(0, -1)} `;
  const tamperedDigest = createHash('sha256').update(tampered).digest('hex');

  if (tamperedDigest === original) return fail('sha256 çakıştı — imkânsız, hesaplama hatalı');
  if (run.signature.text.includes(tamperedDigest)) {
    return fail('kurcalanmış gövdenin özeti de demette var — bağlama işe yaramıyor');
  }
  return pass(`kurcalanmış özet ${tamperedDigest.slice(0, 16)}… demette YOK`);
});

// ---------------------------------------------------------------------------
// 8. Gecikme — P0-G bütçesinin girdisi
// ---------------------------------------------------------------------------
gate.check('Tek çağrının duvar-saati süresi kaydedildi ve bütçe içinde', () => {
  const run = readFixture<RunFixture>(RUN_FIXTURE);
  if (typeof run.latencyMs !== 'number' || run.latencyMs <= 0) {
    return fail(`latencyMs kaydedilmemiş: ${run.latencyMs}`);
  }
  if (run.latencyMs > SINGLE_CALL_BUDGET_MS) {
    return fail(
      `${run.latencyMs} ms — tek çağrı ${SINGLE_CALL_BUDGET_MS} ms bütçesini aşıyor, ` +
        'uçtan uca 60 sn hedefi (P0-G) riskte',
    );
  }
  return pass(`${run.latencyMs} ms · P0-G'nin 60 sn bütçesinde ${((run.latencyMs / 60_000) * 100).toFixed(1)}% pay`);
});

// ---------------------------------------------------------------------------
// 9. Dürüstlük sınırı
// ---------------------------------------------------------------------------
gate.check('Fixture MOCK değil — MOCK_0G demo yoluna sokulmamış', () => {
  const run = readFixture<RunFixture>(RUN_FIXTURE);
  const signer = readFixture<SignerFixture>(SIGNER_FIXTURE);

  // 65 baytlık gerçek secp256k1 imzası: 0x + 130 hex.
  if (!/^0x[0-9a-fA-F]{130}$/.test(run.signature.signature)) {
    return fail(`imza gerçek secp256k1 biçiminde değil: ${run.signature.signature.slice(0, 24)}…`);
  }
  if (!ethers.isAddress(signer.teeSignerAddress) || signer.teeSignerAddress === ethers.ZeroAddress) {
    return fail(`teeSignerAddress geçersiz: ${signer.teeSignerAddress}`);
  }
  const mockFlag = optionalEnv('MOCK_0G');
  if (mockFlag && mockFlag !== '0' && mockFlag !== 'false') {
    return fail(`MOCK_0G=${mockFlag} açık — kapı mock veriyle geçemez`);
  }
  return pass(
    [
      `imza 65 bayt gerçek secp256k1 · signer ${signer.teeSignerAddress}`,
      `sağlayıcı tipi: ${signer.providerType} (${signer.targetSeparated ? 'ayrık TEE' : 'tek TEE'})`,
      'MOCK_0G kapalı',
    ].join('\n'),
  );
});

await gate.run();
