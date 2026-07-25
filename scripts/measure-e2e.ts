// scripts/measure-e2e.ts — P0-G: end-to-end latency + the time distribution.
//
// Five full runs (Alice → discovery → intent → ECIES → Bob → enclave → 0G → seal →
// Alice decrypts → chain confirmation), reporting p50, p95 and the stage distribution.
//
// WHY THE DISTRIBUTION: knowing the total is not enough. If we are slow on recording day we
// need to know WHAT to cut — the model, the chain, or the network. This is exactly BUILD-PLAN
// P0-G's second criterion, exactly.
//
// SPENDS MONEY: one live 0G call + one Base Sepolia tx per run (+ HCS messages).

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { closeBob, runDemo } from '../packages/demo/src/index.js';
import { dominantStage, percentile } from '../packages/shared/src/timing.js';
import { loadDotenv, repoRoot } from '../packages/shared/src/config.js';

loadDotenv();
const root = repoRoot();

const RUNS = 5;

const totals: number[] = [];
const perStage: Record<string, number[]> = {};
const runs: Array<Record<string, unknown>> = [];

console.log(`${RUNS} end-to-end runs — each with live 0G and a live chain\n`);

for (let i = 0; i < RUNS; i += 1) {
  // Each run uses a DIFFERENT nonce: the same intentHash cannot go on chain twice
  // (AlreadyVerified). The brief varies too, so it does not fall back to a fixture replay.
  const report = await runDemo({
    nonce: BigInt(Date.now()) + BigInt(i),
    brief: `Assess revenue-recognition risk in the attached quarterly figures. (run ${i + 1})`,
    log: () => {},
  });

  if (!report.verified) {
    throw new Error(`run ${i + 1} was not verified: ${report.codeName} — the measurement would be meaningless`);
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
    `run ${i + 1}: ${report.totalMs} ms · ${report.computeProvider} · ogVerified=${report.ogVerified}`,
  );
}

await closeBob();

const p50 = percentile(totals, 50);
const p95 = percentile(totals, 95);

// The MEDIAN per stage: so a single slow run does not skew the distribution.
const stageMedian: Record<string, number> = {};
for (const [k, v] of Object.entries(perStage)) stageMedian[k] = percentile(v, 50);

// AGGREGATE line items are excluded when picking the dominant one: they contain other items, so
// their being largest is inevitable and says nothing.
// `http_task_send*` is an aggregate too — it wraps all of Bob's work (including the 0G call).
const AGGREGATES = new Set(['alice_job_total', 'http_task_send1', 'http_task_send2']);
const leaf = Object.fromEntries(Object.entries(stageMedian).filter(([k]) => !AGGREGATES.has(k)));
const dominant = dominantStage(leaf);

console.log(`\n--- TOTAL (${RUNS} runs) ---`);
console.log(`p50 : ${p50} ms`);
console.log(`p95 : ${p95} ms   (budget 60000 ms)`);

console.log('\n--- STAGE DISTRIBUTION (median) ---');
for (const [k, v] of Object.entries(stageMedian).sort((a, b) => b[1] - a[1])) {
  const share = ((v / p50) * 100).toFixed(1);
  const tag = AGGREGATES.has(k) ? ' (aggregate)' : '';
  console.log(`${k.padEnd(26)} ${String(v).padStart(7)} ms  %${share.padStart(5)}${tag}`);
}
console.log(`\nDOMINANT STAGE: ${dominant.label} — ${dominant.ms} ms (${(dominant.share * 100).toFixed(1)}% of leaf items)`);

const dir = resolve(root, 'fixtures/latency');
mkdirSync(dir, { recursive: true });
writeFileSync(
  resolve(dir, 'P0-G.json'),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      // Without knowing the conditions it was measured under, the numbers are uninterpretable.
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
console.log('\nwrote fixtures/latency/P0-G.json');
