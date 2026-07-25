// tests/gates/P0-G.ts — uçtan uca gecikme. Planın "v3'ün tek açık kapısı" dediği adım.
//
// BUILD-PLAN P0-G geçiş kriterleri:
//   [ ] p95 latency < 60 sn
//   [ ] Zaman dağılımı biliniyor: ECIES / 0G çağrısı / seal imzası / ağ — hangisi baskın?
//
// Kapı ölçüm YAPMAZ, ölçümü DOĞRULAR: `npx tsx scripts/measure-e2e.ts` 5 canlı koşu
// yapıp fixtures/latency/P0-G.json üretir (her koşu 1 canlı 0G çağrısı + 1 zincir tx'i).
// Kapının her koşuşunda o parayı yakmanın anlamı yok.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { dominantStage, percentile } from '../../packages/shared/src/timing.js';
import { loadDotenv, repoRoot } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const root = repoRoot();
const gate = new Gate('P0-G', 'Uçtan uca gecikme ve zaman dağılımı');

const FIXTURE = resolve(root, 'fixtures/latency/P0-G.json');
const BUDGET_MS = 60_000;
const MIN_RUNS = 5;

/**
 * Ölçümün bayatlama sınırı. Sağlayıcı değişir, model değişir, zincir yavaşlar —
 * altı ay önceki ölçümle "60 sn altındayız" demek kanıt değil, temenni olur.
 */
const MAX_AGE_DAYS = 7;

type Latency = {
  capturedAt: string;
  paymentRail: string;
  paymentGateHit: boolean;
  runs: number;
  totals: number[];
  p50: number;
  p95: number;
  budgetMs: number;
  stageMedianMs: Record<string, number>;
  aggregateStages: string[];
  dominant: { label: string; ms: number; share: number };
  detail: Array<{ run: number; totalMs: number; txHash?: string; computeProvider: string; ogVerified: boolean; intentEchoed: boolean }>;
};

const read = (): Latency => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Latency;

// ---------------------------------------------------------------------------
// 1. Ölçüm var ve taze
// ---------------------------------------------------------------------------
gate.check('Ölçüm dosyası var, yeterli koşu içeriyor ve TAZE', () => {
  if (!existsSync(FIXTURE)) {
    return fail('fixtures/latency/P0-G.json yok — üret: npx tsx scripts/measure-e2e.ts (PARA HARCAR)');
  }
  const l = read();
  if (l.runs < MIN_RUNS || l.totals.length < MIN_RUNS) {
    return fail(`${l.totals.length} koşu var, en az ${MIN_RUNS} gerekiyor`);
  }
  const ageDays = (Date.now() - Date.parse(l.capturedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return fail(`capturedAt okunamadı: ${l.capturedAt}`);
  if (ageDays > MAX_AGE_DAYS) {
    return fail(`ölçüm ${ageDays.toFixed(1)} gün önce — ${MAX_AGE_DAYS} günden eski, yeniden ölç`);
  }
  return pass(`${l.totals.length} koşu · ${ageDays.toFixed(1)} gün önce · ray: ${l.paymentRail}`);
});

// ---------------------------------------------------------------------------
// 2. Koşular GERÇEK — mock ölçmenin anlamı yok
// ---------------------------------------------------------------------------
gate.check('Ölçülen koşular canlı 0G ve canlı zincir kullanmış', () => {
  const l = read();
  const notLive = l.detail.filter((d) => d.computeProvider !== '0g-sealed-inference');
  if (notLive.length > 0) {
    return fail(
      `${notLive.length} koşu canlı 0G değil (${notLive.map((d) => d.computeProvider).join(', ')}) — ` +
        'replay ölçmek gecikmeyi olduğundan iyi gösterir',
    );
  }
  const noTx = l.detail.filter((d) => !d.txHash);
  if (noTx.length > 0) return fail(`${noTx.length} koşuda zincir tx'i yok — uçtan uca değil`);

  const notVerified = l.detail.filter((d) => !d.ogVerified);
  if (notVerified.length > 0) return fail(`${notVerified.length} koşuda ogVerified=false`);

  return pass(
    [
      `${l.detail.length}/${l.detail.length} koşu: canlı 0G + zincir tx'i + ogVerified`,
      `intentEchoed: ${l.detail.filter((d) => d.intentEchoed).length}/${l.detail.length}`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 3. ASIL KRİTER: p95 < 60 sn
// ---------------------------------------------------------------------------
gate.check(`p95 uçtan uca gecikme < ${BUDGET_MS / 1000} sn`, () => {
  const l = read();

  // Kaydedilen p95'e güvenmiyoruz — ham örneklemden yeniden hesaplıyoruz.
  const p50 = percentile(l.totals, 50);
  const p95 = percentile(l.totals, 95);
  if (p95 !== l.p95) return fail(`kaydedilen p95 ${l.p95}, ham veriden ${p95} — dosya tutarsız`);

  if (p95 >= BUDGET_MS) {
    return fail(
      `p95 ${p95} ms — bütçe ${BUDGET_MS} ms.\n` +
        'Plan sırası: daha küçük model → maxTokens düşür → brief kısalt → kayıttan önce pre-warm',
    );
  }
  return pass(
    [
      `p50 ${p50} ms · p95 ${p95} ms`,
      `bütçenin %${((p95 / BUDGET_MS) * 100).toFixed(1)}'i · pay: ${((BUDGET_MS - p95) / 1000).toFixed(1)} sn`,
      `örneklem: ${[...l.totals].sort((a, b) => a - b).join(', ')} ms`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 4. İKİNCİ KRİTER: dağılım biliniyor
// ---------------------------------------------------------------------------
gate.check('Zaman dağılımı biliniyor — hangi aşama baskın, sayıyla', () => {
  const l = read();

  // Planın adıyla saydığı aşamalar ölçülmüş olmalı; biri eksikse "biliyoruz" diyemeyiz.
  const required = ['enclave_ecies_decrypt', 'enclave_compute_0g', 'enclave_seal_sign', 'chain_verify_tx'];
  const missing = required.filter((k) => !(k in l.stageMedianMs));
  if (missing.length > 0) return fail(`ölçülmemiş aşamalar: ${missing.join(', ')}`);

  // Baskın kalem KAPSAYICI olmamalı — `alice_job_total` "baskın" demek bilgi vermez.
  const aggregates = new Set(l.aggregateStages);
  if (aggregates.has(l.dominant.label)) {
    return fail(`baskın olarak kapsayıcı kalem seçilmiş: ${l.dominant.label}`);
  }

  // Kaydedilen sonucu yeniden hesaplayıp doğrula.
  const leaf = Object.fromEntries(Object.entries(l.stageMedianMs).filter(([k]) => !aggregates.has(k)));
  const recomputed = dominantStage(leaf);
  if (recomputed.label !== l.dominant.label) {
    return fail(`kaydedilen baskın ${l.dominant.label}, yeniden hesap ${recomputed.label}`);
  }

  const top = Object.entries(leaf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `  ${k.padEnd(26)} ${String(v).padStart(6)} ms`);

  return pass(
    [
      `BASKIN: ${recomputed.label} — ${recomputed.ms} ms (yaprakların %${(recomputed.share * 100).toFixed(1)}'i)`,
      ...top,
      'kripto aşamaları (ECIES, seal, recompute) toplamı milisaniyeler — hızlandırılacak yer değil',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 5. Bulgunun sonucu: neyi kısacağımızı biliyoruz
// ---------------------------------------------------------------------------
gate.check('Yavaşlarsak ne yapacağımız ölçüme dayanıyor', () => {
  const l = read();
  const crypto = ['enclave_ecies_decrypt', 'enclave_recompute', 'enclave_seal_sign', 'ecies_encrypt', 'intent_sign']
    .map((k) => l.stageMedianMs[k] ?? 0)
    .reduce((a, b) => a + b, 0);

  // Kriptoyu optimize etmek boşa emek olurdu — bunu ölçmeden bilemezdik.
  if (crypto > l.p50 * 0.05) {
    return fail(`kripto aşamaları toplam ${crypto} ms — p50'nin %5'inden fazlası, varsayım güncellenmeli`);
  }

  const compute = l.stageMedianMs.enclave_compute_0g ?? 0;
  const chain = l.stageMedianMs.chain_verify_tx ?? 0;
  const lever = compute > chain ? 'model/maxTokens (0G çağrısı)' : 'zincir onayı bekleme';

  return pass(
    [
      `0G çağrısı ${compute} ms · zincir ${chain} ms · tüm kripto ${crypto} ms`,
      `Kaldıraç: ${lever}`,
      compute > chain
        ? 'Sıkışırsak: maxTokens düşür / brief kısalt / kayıttan 2 dk önce pre-warm çağrısı at'
        : 'Sıkışırsak: zincir onayını beklemeden UI\'ı ilerlet, tx linkini sonradan göster',
    ].join('\n'),
  );
});

await gate.run();
