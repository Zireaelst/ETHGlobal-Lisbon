// scripts/measure-e2e.ts — P0-G: uçtan uca gecikme + zaman dağılımı.
//
// 5 tam koşu (Alice → keşif → intent → ECIES → Bob → enclave → 0G → seal →
// Alice çözer → zincir onayı), p50 ve p95 ile aşama dağılımı.
//
// NEDEN DAĞILIM: toplam süreyi bilmek yetmiyor. Video günü yavaşlarsak NEYİ
// kısacağımızı bilmemiz gerekiyor — model mi, zincir mi, ağ mı. BUILD-PLAN
// P0-G'nin ikinci kriteri tam olarak bu.
//
// PARA HARCAR: koşu başına 1 canlı 0G çağrısı + 1 Base Sepolia tx (+ HCS mesajları).

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { closeBob, runDemo } from './demo.js';
import { dominantStage, percentile } from '../packages/shared/src/timing.js';
import { loadDotenv, repoRoot } from '../packages/shared/src/config.js';

loadDotenv();
const root = repoRoot();

const RUNS = 5;

const totals: number[] = [];
const perStage: Record<string, number[]> = {};
const runs: Array<Record<string, unknown>> = [];

console.log(`${RUNS} uçtan uca koşu — her biri canlı 0G + canlı zincir\n`);

for (let i = 0; i < RUNS; i += 1) {
  // Her koşu FARKLI bir nonce ile: aynı intentHash ikinci kez zincire gidemez
  // (AlreadyVerified). Ayrıca fixture replay'e düşmesin diye brief de değişiyor.
  const report = await runDemo({
    nonce: BigInt(Date.now()) + BigInt(i),
    brief: `Assess revenue-recognition risk in the attached quarterly figures. (run ${i + 1})`,
    log: () => {},
  });

  if (!report.verified) {
    throw new Error(`koşu ${i + 1} doğrulanmadı: ${report.codeName} — ölçüm anlamsız olurdu`);
  }

  totals.push(report.totalMs);
  for (const [k, v] of Object.entries(report.stageMs)) {
    (perStage[k] ??= []).push(v);
  }
  runs.push({
    run: i + 1,
    totalMs: report.totalMs,
    txHash: report.txHash,
    computeProvider: report.computeProvider,
    ogVerified: report.ogVerified,
    intentEchoed: report.output.includes(report.signedIntentHash),
    paymentRequired: report.payment !== undefined,
    stageMs: report.stageMs,
  });

  console.log(
    `koşu ${i + 1}: ${report.totalMs} ms · ${report.computeProvider} · ogVerified=${report.ogVerified}`,
  );
}

await closeBob();

const p50 = percentile(totals, 50);
const p95 = percentile(totals, 95);

// Aşama başına MEDYAN: tek bir yavaş koşu dağılımı yamultmasın.
const stageMedian: Record<string, number> = {};
for (const [k, v] of Object.entries(perStage)) stageMedian[k] = percentile(v, 50);

// Baskın kalemi ararken KAPSAYICI kalemler hariç: bunlar başka kalemleri
// içeriyor, en büyük çıkmaları kaçınılmaz ve hiçbir şey söylemiyor.
// `http_task_send*` de kapsayıcıdır — Bob'un tüm işini (0G çağrısı dahil) sarar.
const AGGREGATES = new Set(['alice_job_total', 'http_task_send1', 'http_task_send2']);
const leaf = Object.fromEntries(Object.entries(stageMedian).filter(([k]) => !AGGREGATES.has(k)));
const dominant = dominantStage(leaf);

console.log(`\n--- TOPLAM (${RUNS} koşu) ---`);
console.log(`p50 : ${p50} ms`);
console.log(`p95 : ${p95} ms   (bütçe 60000 ms)`);

console.log('\n--- AŞAMA DAĞILIMI (medyan) ---');
for (const [k, v] of Object.entries(stageMedian).sort((a, b) => b[1] - a[1])) {
  const share = ((v / p50) * 100).toFixed(1);
  const tag = AGGREGATES.has(k) ? ' (kapsayıcı)' : '';
  console.log(`${k.padEnd(26)} ${String(v).padStart(7)} ms  %${share.padStart(5)}${tag}`);
}
console.log(`\nBASKIN AŞAMA: ${dominant.label} — ${dominant.ms} ms (yaprak kalemlerin %${(dominant.share * 100).toFixed(1)}'i)`);

const dir = resolve(root, 'fixtures/latency');
mkdirSync(dir, { recursive: true });
writeFileSync(
  resolve(dir, 'P0-G.json'),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      // Hangi koşulda ölçüldüğü olmadan sayılar yorumlanamaz.
      paymentRail: process.env.PAYMENT_BACKEND ?? 'none',
      paymentGateHit: runs.some((r) => (r as { paymentRequired?: boolean }).paymentRequired === true),
      runs: RUNS,
      totals,
      p50,
      p95,
      budgetMs: 60_000,
      stageMedianMs: stageMedian,
      aggregateStages: [...AGGREGATES],
      dominant,
      detail: runs,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log('\nfixtures/latency/P0-G.json yazıldı');
