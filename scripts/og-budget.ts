// scripts/og-budget.ts — P0-D: 0G çağrı başı maliyet ölçümü + bütçe tablosu.
//
// Bu script BİR gerçek çağrı yapar (para harcar) ve fixtures/og/budget.json üretir.
//
// Maliyeti İKİ bağımsız yoldan buluyoruz ve ikisini karşılaştırıyoruz:
//   (1) alt hesap bakiyesindeki fark — gerçekte ne düşüldü
//   (2) fiyat × token  — kontrattaki tarifeden hesap
// 0G ücretleri TEE settlement'ı ile GECİKMELİ düşüyor, o yüzden (1) kısa vadede
// 0 görünebilir. Bu durumda (2) esas alınır ama fark rapor edilir — sessizce
// "maliyet sıfır" demek bütçeyi yanlış kurmamıza yol açar.

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

/** P0-D kriteri: demo + 3 video için asgari çağrı sayısı. */
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
if (!svc) throw new Error(`sağlayıcı ${signerFixture.provider} listede yok`);

console.log(`sağlayıcı : ${svc.provider}`);
console.log(`model     : ${svc.model}`);
console.log(`tarife    : girdi ${svc.inputPrice} / çıktı ${svc.outputPrice} neuron-per-token\n`);

/**
 * Sağlayıcı alt hesabının bakiyesi — ölçüm (1).
 *
 * NOT: bu sürümde `broker.ledger.getLedgerWithDetail` YOK (tiplerde görünüyor,
 * gerçekte tanımlı değil). Alt hesabı inference tarafından okuyoruz.
 */
async function subAccountBalance(): Promise<bigint> {
  const account = await broker.inference.getAccount(svc!.provider);
  return BigInt(account.balance);
}

const ledgerBefore = await broker.ledger.getLedger();
const subBefore = await subAccountBalance();
console.log(`defter önce   : ${ethers.formatEther(ledgerBefore.totalBalance)} OG`);
console.log(`alt hesap önce: ${ethers.formatEther(subBefore)} OG\n`);

// --- tek gerçek çağrı ---
const { endpoint, model } = await broker.inference.getServiceMetadata(svc.provider);
const headers = await broker.inference.getRequestHeaders(svc.provider);

console.log('çağrı yapılıyor …');
const startedAt = Date.now();
const res = await fetch(`${endpoint}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }] }),
});
const latencyMs = Date.now() - startedAt;
if (!res.ok) throw new Error(`çağrı başarısız: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);

const rawResponseText = await res.text();
const completion = JSON.parse(rawResponseText) as {
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};
const chatID = res.headers.get('ZG-Res-Key');

const promptTokens = BigInt(completion.usage?.prompt_tokens ?? 0);
const completionTokens = BigInt(completion.usage?.completion_tokens ?? 0);
console.log(`yanıt : ${latencyMs} ms · girdi ${promptTokens} token, çıktı ${completionTokens} token\n`);

// Ücretin işlenmesi için processResponse'u çağırıyoruz (SDK harcamayı burada kaydediyor).
await broker.inference.processResponse(svc.provider, chatID ?? undefined, JSON.stringify(completion.usage ?? {}));

const subAfter = await subAccountBalance();
const ledgerAfter = await broker.ledger.getLedger();

// --- ölçüm (2): tarifeden hesap ---
const formulaCost = promptTokens * svc.inputPrice + completionTokens * svc.outputPrice;
// --- ölçüm (1): bakiye farkı ---
const observedCost = subBefore > subAfter ? subBefore - subAfter : 0n;

const asOG = (n: bigint) => Number(n) / Number(NEURON_PER_OG);

console.log(`tarifeden hesap : ${formulaCost} neuron = ${asOG(formulaCost).toFixed(9)} OG`);
console.log(`bakiye farkı    : ${observedCost} neuron = ${asOG(observedCost).toFixed(9)} OG`);
if (observedCost === 0n) {
  console.log('NOT: bakiye farkı 0 — 0G ücreti TEE settlement ile gecikmeli düşüyor. Tarife esas alınıyor.\n');
} else {
  const drift = Number(observedCost - formulaCost) / Number(formulaCost || 1n);
  console.log(`NOT: iki ölçüm arası sapma %${(drift * 100).toFixed(2)}\n`);
}

// Bütçeyi HANGİSİ BÜYÜKSE ona göre kur — iyimser tarafa yanılmak bütçeyi patlatır.
const costPerCall = observedCost > formulaCost ? observedCost : formulaCost;
const spendable = ledgerAfter.totalBalance;
const remainingCalls = costPerCall === 0n ? Number.POSITIVE_INFINITY : Number(spendable / costPerCall);

console.log(`çağrı başı maliyet : ${asOG(costPerCall).toFixed(9)} OG`);
console.log(`defterde           : ${ethers.formatEther(spendable)} OG`);
console.log(`kalan çağrı sayısı : ${remainingCalls.toLocaleString('tr-TR')}\n`);

// --- BUILD-PLAN P0-D/3: bütçe bölüşümü yazılı olacak ---
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
        ? 'bakiye farkı 0 görüldü (TEE settlement gecikmeli); tarife esas alındı'
        : 'iki bağımsız ölçüm mevcut; büyük olan esas alındı',
  },
  ledgerOG: Number(ethers.formatEther(spendable)),
  remainingCalls,
  allocation: { ...allocation, reserve },
  minRequired: MIN_REMAINING_CALLS,
  storageBonusDecision: storageBonus ? 'VAR' : 'YOK',
  storageBonusReason: storageBonus
    ? `kalan çağrı (${remainingCalls}) 100'ün üzerinde — P3-E denenebilir`
    : `kalan çağrı (${remainingCalls}) dar — P3-E ŞİMDİ düşürülüyor, P3'ün ortasında değil`,
};

const dir = resolve(root, 'fixtures/og');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'budget.json'), `${JSON.stringify(budget, null, 2)}\n`, 'utf8');

console.log('BÜTÇE BÖLÜŞÜMÜ');
console.log(`  P3 geliştirme : ${allocation.p3Development}`);
console.log(`  prova         : ${allocation.dryRun}`);
console.log(`  demo + video  : ${allocation.demoAndVideos}`);
console.log(`  rezerv        : ${reserve}`);
console.log(`\n0G Storage bonusu (P3-E): ${budget.storageBonusDecision} — ${budget.storageBonusReason}`);
console.log('\nfixtures/og/budget.json yazıldı');
