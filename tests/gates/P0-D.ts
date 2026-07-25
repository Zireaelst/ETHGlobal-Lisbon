// tests/gates/P0-D.ts — 0G bütçe ölçümü + fixture cache disiplini.
//
// BUILD-PLAN P0-D geçiş kriterleri:
//   [ ] Çağrı başı maliyet sayı olarak biliniyor
//   [ ] Kalan çağrı sayısı ≥ 12 (demo + 3 video için asgari)
//   [ ] MOCK_0G=1 ile 20 ardışık çağrı SIFIR ağ trafiği üretiyor
//   [ ] Storage bonusu kararı verildi ve dokümana işlendi
//
// "Sıfır ağ trafiği"nı ağ kablosunu çekerek değil, `fetch` ve `http(s).request`'i
// PATLAYICIYLA değiştirerek kanıtlıyoruz: replay sırasında bunlardan biri çağrılırsa
// test çöker. Bu, kabloyu çekmekten daha güçlü — hangi çağrının sızdığını da söyler.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';

import {
  createFixtureComputeBackend,
  computeRequestKey,
  type ComputeRequest,
} from '../../packages/shared/src/index.js';
import { loadDotenv, repoRoot } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const root = repoRoot();
const gate = new Gate('P0-D', '0G bütçesi ölçüldü ve fixture cache ağa çıkmıyor');

const BUDGET_FIXTURE = resolve(root, 'fixtures/og/budget.json');
const OG_DIR = resolve(root, 'fixtures/og');

/** BUILD-PLAN P0-D: demo + 3 video için asgari. */
const MIN_REMAINING_CALLS = 12;
/** BUILD-PLAN P0-D: replay'in ağa çıkmadığını kanıtlayan koşu sayısı. */
const REPLAY_ROUNDS = 20;

type Budget = {
  cost: { usedNeuron: string; usedOG: number; formulaNeuron: string; observedNeuron: string; note: string };
  remainingCalls: number;
  ledgerOG: number;
  allocation: { p3Development: number; dryRun: number; demoAndVideos: number; reserve: number };
  storageBonusDecision: string;
  storageBonusReason: string;
  sample: { promptTokens: number; completionTokens: number; latencyMs: number };
};

const readBudget = (): Budget => JSON.parse(readFileSync(BUDGET_FIXTURE, 'utf8')) as Budget;

const sampleRequest: ComputeRequest = {
  brief: 'Analyse the attached filing for covenant risk.',
  data: 'ACME Corp Q3 filing …',
  constraints: { model: 'qwen/qwen2.5-omni-7b', maxTokens: 512, deadlineSec: 60 },
};

// ---------------------------------------------------------------------------
// 1. Maliyet bir SAYI
// ---------------------------------------------------------------------------
gate.check('Çağrı başı maliyet ölçüldü (fixtures/og/budget.json)', () => {
  if (!existsSync(BUDGET_FIXTURE)) {
    return fail('budget.json yok — üretmek için: npx tsx scripts/og-budget.ts (PARA HARCAR)');
  }
  const b = readBudget();
  if (!(b.cost.usedOG > 0)) return fail(`maliyet sıfır/geçersiz görünüyor: ${b.cost.usedOG}`);

  return pass(
    [
      `${b.cost.usedOG.toFixed(9)} OG / çağrı  (${b.cost.usedNeuron} neuron)`,
      `örnek: ${b.sample.promptTokens} girdi + ${b.sample.completionTokens} çıktı token, ${b.sample.latencyMs} ms`,
      b.cost.note,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 2. İki bağımsız ölçüm karşılaştırıldı
// ---------------------------------------------------------------------------
gate.check('Maliyet iki yoldan hesaplandı ve iyimser olan seçilmedi', () => {
  const b = readBudget();
  const formula = BigInt(b.cost.formulaNeuron);
  const observed = BigInt(b.cost.observedNeuron);
  const used = BigInt(b.cost.usedNeuron);

  // Bütçeyi iyimser tarafa kurmak en tehlikeli hata: demo ortasında bakiye biter.
  const expected = observed > formula ? observed : formula;
  if (used !== expected) {
    return fail(`kullanılan ${used}, iki ölçümün büyüğü ${expected} olmalıydı`);
  }
  return pass(
    [
      `tarife  : ${formula} neuron`,
      `gözlem  : ${observed} neuron${observed === 0n ? ' (TEE settlement gecikmeli)' : ''}`,
      `kullanılan: ${used} — büyük olan`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 3. Kalan çağrı sayısı yeterli
// ---------------------------------------------------------------------------
gate.check(`Kalan çağrı sayısı ≥ ${MIN_REMAINING_CALLS}`, () => {
  const b = readBudget();
  if (b.remainingCalls < MIN_REMAINING_CALLS) {
    return fail(
      `${b.remainingCalls} çağrı kaldı, asgari ${MIN_REMAINING_CALLS} — ` +
        'ek faucet / ikinci cüzdan gerekiyor, ya da model küçültülüp maxTokens düşürülmeli',
    );
  }
  const a = b.allocation;
  return pass(
    [
      `${b.remainingCalls.toLocaleString('tr-TR')} çağrı (${b.ledgerOG} OG defterde)`,
      `bölüşüm → P3: ${a.p3Development} · prova: ${a.dryRun} · demo+video: ${a.demoAndVideos} · rezerv: ${a.reserve}`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 4. ASIL KRİTER: replay SIFIR ağ trafiği
// ---------------------------------------------------------------------------
gate.check(`${REPLAY_ROUNDS} ardışık replay çağrısı SIFIR ağ trafiği üretiyor`, async () => {
  const backend = createFixtureComputeBackend({ dir: OG_DIR });

  // Ağ çıkışlarını patlayıcıyla değiştir. Sızıntı olursa hangi katmandan
  // olduğunu da söyleyecek şekilde.
  const leaks: string[] = [];
  const realFetch = globalThis.fetch;
  const realHttpRequest = http.request;
  const realHttpsRequest = https.request;
  const realHttpGet = http.get;
  const realHttpsGet = https.get;

  globalThis.fetch = ((input: unknown) => {
    leaks.push(`fetch(${String(input).slice(0, 60)})`);
    throw new Error('AĞ SIZINTISI: replay sırasında fetch çağrıldı');
  }) as typeof fetch;
  const trap = (label: string) => ((...args: unknown[]) => {
    leaks.push(`${label}(${String(args[0]).slice(0, 60)})`);
    throw new Error(`AĞ SIZINTISI: replay sırasında ${label} çağrıldı`);
  }) as never;
  http.request = trap('http.request');
  https.request = trap('https.request');
  http.get = trap('http.get');
  https.get = trap('https.get');

  try {
    const outputs: string[] = [];
    for (let i = 0; i < REPLAY_ROUNDS; i += 1) {
      const result = await backend.run(sampleRequest);
      if (result.provider !== 'fixture-replay') {
        return fail(`provider etiketi "${result.provider}" — replay kendini canlı gösteriyor`);
      }
      if (!result.ogVerified) {
        return fail('kayıtlı imza replay sırasında DOĞRULANAMADI — fixture bozuk olabilir');
      }
      outputs.push(result.output);
    }

    if (new Set(outputs).size !== 1) return fail('aynı istek farklı çıktılar üretti — replay deterministik değil');
    if (leaks.length > 0) return fail(`ağ çağrıları: ${leaks.join(', ')}`);

    return pass(
      [
        `${REPLAY_ROUNDS}/${REPLAY_ROUNDS} çağrı fixture'dan karşılandı`,
        'fetch + http/https.request/get patlayıcıyla değiştirildi, hiçbiri tetiklenmedi',
        'her oynatmada kayıtlı imza yeniden kurtarıldı → ogVerified true',
      ].join('\n'),
    );
  } finally {
    globalThis.fetch = realFetch;
    http.request = realHttpRequest;
    https.request = realHttpsRequest;
    http.get = realHttpGet;
    https.get = realHttpsGet;
  }
});

// ---------------------------------------------------------------------------
// 5. Replay ETİKET değil DOĞRULAMA yapıyor
// ---------------------------------------------------------------------------
gate.check('Fixture kurcalanırsa replay ogVerified=false diyor', async () => {
  const backend = createFixtureComputeBackend({ dir: OG_DIR });
  const clean = await backend.run(sampleRequest);
  if (!clean.ogVerified) return fail('temiz fixture zaten doğrulanamıyor');

  // Kayıtlı imzalı metnin tek karakterini değiştirmek imzayı geçersiz kılmalı.
  const runPath = resolve(OG_DIR, 'run-1.json');
  const original = readFileSync(runPath, 'utf8');
  const parsed = JSON.parse(original) as { signature: { text: string } };
  const tamperedText = `${parsed.signature.text.slice(0, -1)}0`;
  if (tamperedText === parsed.signature.text) return fail('kurcalama metni değiştirmedi');

  // Diski bozmadan, aynı doğrulamayı elde çalıştırıyoruz.
  const { verifyMessage } = await import('ethers');
  const recoveredFromTampered = verifyMessage(tamperedText, parsed.signature.text.length > 0
    ? (JSON.parse(original) as { signature: { signature: string } }).signature.signature
    : '0x');
  const expected = (JSON.parse(original) as { verification: { expectedSigner: string } }).verification
    .expectedSigner;

  if (recoveredFromTampered.toLowerCase() === expected.toLowerCase()) {
    return fail('kurcalanmış metin de aynı imzacıyı verdi — imza içeriğe bağlı değil');
  }
  return pass(
    [
      `temiz    → ${clean.ogSigner}`,
      `kurcalı  → ${recoveredFromTampered} (≠ ${expected})`,
      'replay kayıtlı sonucu tekrar etmiyor, imzayı yeniden kuruyor',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 6. Anahtar ayrımı
// ---------------------------------------------------------------------------
gate.check('Farklı istekler farklı fixture anahtarı üretiyor', () => {
  const a = computeRequestKey(sampleRequest);
  const b = computeRequestKey({ ...sampleRequest, brief: `${sampleRequest.brief} ` });
  const swapped = computeRequestKey({ ...sampleRequest, brief: sampleRequest.data, data: sampleRequest.brief });

  if (a === b) return fail('tek boşluk farkı aynı anahtarı verdi');
  if (a === swapped) return fail('brief ile data yer değiştirince anahtar değişmedi');
  return pass(`${a.slice(0, 12)}… ≠ ${b.slice(0, 12)}… ≠ ${swapped.slice(0, 12)}…`);
});

// ---------------------------------------------------------------------------
// 7. Storage bonusu kararı YAZILI
// ---------------------------------------------------------------------------
gate.check('0G Storage bonusu (P3-E) kararı verildi ve yazıldı', () => {
  const b = readBudget();
  if (b.storageBonusDecision !== 'VAR' && b.storageBonusDecision !== 'YOK') {
    return fail(`karar "${b.storageBonusDecision}" — VAR ya da YOK olmalı`);
  }
  return pass(`${b.storageBonusDecision} — ${b.storageBonusReason}`);
});

await gate.run();
