// scripts/og-budget.ts — P0-D: measuring the per-call 0G cost + the budget table.
//
// This script makes ONE real call (spending money) and produces fixtures/og/budget.json.
//
// We derive the cost TWO independent ways and compare them:
//   (1) the delta in the sub-account balance — what was actually deducted
//   (2) price × tokens — computed from the tariff in the contract
// 0G fees are deducted LAZILY through TEE settlement, so in the short term (1) can read 0. In
// that case (2) is used, but the difference is reported — silently concluding "the cost is
// zero" would lead us to budget wrongly.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';
import { loadDotenv, repoRoot, requireEnv } from '../packages/shared/src/config.js';

const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

loadDotenv();
const root = repoRoot();

/** 1 OG = 1e18 neuron. */
const NEURON_PER_OG = 10n ** 18n;

/** The P0-D criterion: the minimum number of calls for the demo + 3 videos. */
const MIN_REMAINING_CALLS = 12;

const PROMPT =
  'You are a security analyst. In exactly three sentences, explain why binding a ' +
  'payment intent hash to a model output matters for autonomous agent marketplaces.';

const provider = new ethers.JsonRpcProvider(requireEnv('OG_RPC_URL'));
const wallet = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);
const broker = await createZGComputeNetworkBroker(wallet);

const signerFixture = JSON.parse(
  readFileSync(resolve(root, 'fixtures/og/signer.json'), 'utf8'),
) as { provider: string; model: string; url: string };

const services = Array.from(await broker.inference.listService(0, 50, true)) as Array<{
  provider: string;
  model: string;
  inputPrice: bigint;
  outputPrice: bigint;
}>;
const svc = services.find((s) => s.provider.toLowerCase() === signerFixture.provider.toLowerCase());
if (!svc) throw new Error(`provider ${signerFixture.provider} is not in the list`);

console.log(`provider  : ${svc.provider}`);
console.log(`model     : ${svc.model}`);
console.log(`tariff    : input ${svc.inputPrice} / output ${svc.outputPrice} neuron-per-token\n`);

/**
 * The provider sub-account's balance — measurement (1).
 *
 * NOTE: `broker.ledger.getLedgerWithDetail` does NOT exist in this version (it appears in the
 * types but is not actually defined). We read the sub-account from the inference side.
 */
async function subAccountBalance(): Promise<bigint> {
  const account = await broker.inference.getAccount(svc!.provider);
  return BigInt(account.balance);
}

const ledgerBefore = await broker.ledger.getLedger();
const subBefore = await subAccountBalance();
console.log(`ledger before    : ${ethers.formatEther(ledgerBefore.totalBalance)} OG`);
console.log(`sub-account before: ${ethers.formatEther(subBefore)} OG\n`);

// --- one real call ---
const { endpoint, model } = await broker.inference.getServiceMetadata(svc.provider);
const headers = await broker.inference.getRequestHeaders(svc.provider);

console.log('calling …');
const startedAt = Date.now();
const res = await fetch(`${endpoint}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }] }),
});
const latencyMs = Date.now() - startedAt;
if (!res.ok) throw new Error(`call failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);

const rawResponseText = await res.text();
const completion = JSON.parse(rawResponseText) as {
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};
const chatID = res.headers.get('ZG-Res-Key');

const promptTokens = BigInt(completion.usage?.prompt_tokens ?? 0);
const completionTokens = BigInt(completion.usage?.completion_tokens ?? 0);
console.log(`response: ${latencyMs} ms · ${promptTokens} input tokens, ${completionTokens} output tokens\n`);

// We call processResponse so the fee is processed (the SDK records the spend here).
await broker.inference.processResponse(svc.provider, chatID ?? undefined, JSON.stringify(completion.usage ?? {}));

const subAfter = await subAccountBalance();
const ledgerAfter = await broker.ledger.getLedger();

// --- measurement (2): computed from the tariff ---
const formulaCost = promptTokens * svc.inputPrice + completionTokens * svc.outputPrice;
// --- measurement (1): the balance delta ---
const observedCost = subBefore > subAfter ? subBefore - subAfter : 0n;

const asOG = (n: bigint) => Number(n) / Number(NEURON_PER_OG);

console.log(`from tariff     : ${formulaCost} neuron = ${asOG(formulaCost).toFixed(9)} OG`);
console.log(`balance delta   : ${observedCost} neuron = ${asOG(observedCost).toFixed(9)} OG`);
if (observedCost === 0n) {
  console.log('NOTE: balance delta is 0 — 0G fees are deducted lazily via TEE settlement. Using the tariff.\n');
} else {
  const drift = Number(observedCost - formulaCost) / Number(formulaCost || 1n);
  console.log(`NOTE: divergence between the two measurements: ${(drift * 100).toFixed(2)}%\n`);
}

// Budget against WHICHEVER IS LARGER — erring optimistically blows the budget.
const costPerCall = observedCost > formulaCost ? observedCost : formulaCost;
const spendable = ledgerAfter.totalBalance;
const remainingCalls = costPerCall === 0n ? Number.POSITIVE_INFINITY : Number(spendable / costPerCall);

console.log(`cost per call    : ${asOG(costPerCall).toFixed(9)} OG`);
console.log(`in ledger        : ${ethers.formatEther(spendable)} OG`);
console.log(`remaining calls  : ${remainingCalls.toLocaleString('en-GB')}\n`);

// --- BUILD-PLAN P0-D/3: the budget allocation must be written down ---
const allocation = {
  p3Development: Math.floor(remainingCalls / 2),
  dryRun: 3,
  demoAndVideos: 6,
};
const reserve = remainingCalls - allocation.p3Development - allocation.dryRun - allocation.demoAndVideos;

const storageBonus = remainingCalls >= 100;

const budget = {
  capturedAt: new Date().toISOString(),
  provider: svc.provider,
  model: svc.model,
  tariff: { inputPricePerToken: svc.inputPrice.toString(), outputPricePerToken: svc.outputPrice.toString() },
  sample: {
    promptTokens: Number(promptTokens),
    completionTokens: Number(completionTokens),
    latencyMs,
    chatID,
  },
  cost: {
    formulaNeuron: formulaCost.toString(),
    observedNeuron: observedCost.toString(),
    usedNeuron: costPerCall.toString(),
    usedOG: asOG(costPerCall),
    note:
      observedCost === 0n
        ? 'balance delta read 0 (TEE settlement is lazy); the tariff was used'
        : 'two independent measurements exist; the larger one was used',
  },
  ledgerOG: Number(ethers.formatEther(spendable)),
  remainingCalls,
  allocation: { ...allocation, reserve },
  minRequired: MIN_REMAINING_CALLS,
  storageBonusDecision: storageBonus ? 'YES' : 'NO',
  storageBonusReason: storageBonus
    ? `remaining calls (${remainingCalls}) exceed 100 — P3-E can be attempted`
    : `remaining calls (${remainingCalls}) are tight — P3-E is dropped NOW, not mid-P3`,
};

const dir = resolve(root, 'fixtures/og');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'budget.json'), `${JSON.stringify(budget, null, 2)}\n`, 'utf8');

console.log('BUDGET ALLOCATION');
console.log(`  P3 development: ${allocation.p3Development}`);
console.log(`  dry run       : ${allocation.dryRun}`);
console.log(`  demo + videos : ${allocation.demoAndVideos}`);
console.log(`  reserve       : ${reserve}`);
console.log(`\n0G Storage bonus (P3-E): ${budget.storageBonusDecision} — ${budget.storageBonusReason}`);
console.log('\nwrote fixtures/og/budget.json');
