// scripts/demo.ts — uçtan uca hero akışı (BUILD-PLAN P3-D).
//
//   Alice → keşif (The Graph) → intent (EIP-712) → ECIES → Bob → binding (enclave)
//         → seal imzası → Alice çözer → verifyJob → JobVerified (Base Sepolia)
//
// Tek komut: `pnpm demo:base`
//
// Fraud modları aynı akıştan geçer, sadece Bob'un DIŞ katmanı hile yapar; enclave
// her koşulda dürüsttür. Reddi kontrat verir.
//
// Kritik tasarım noktası: Alice zincire gönderdiği `intentHash`'i Bob'un SÖZÜNDEN
// değil, ENCLAVE'İN İMZALADIĞI GÖVDEDEN çözerek alır. Böylece `selfintent` gibi
// "Bob kendi işini uydurdu" senaryosu gerçekçi biçimde temsil edilir: uydurma hash
// gövdededir, Alice'in imzası ona ait değildir, kontrat `BadClientSig` verir.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { createBobAgent, type BobAgent } from '../packages/bob-agent/src/index.js';
import type { FraudMode } from '../packages/bob-agent/src/fraud.js';
import { runAliceJob } from '../packages/alice-agent/src/index.js';
import { decodeBody } from '../packages/bob-binding/src/binding.js';
import {
  describeCompute,
  selectComputeBackend,
  createStopwatch,
  type StageMs,
  type Constraints,
  type EchoResult,
} from '../packages/shared/src/index.js';
import { deriveAgentStealthKeys } from '../packages/payment/src/stealth.js';
import { loadConfig, loadDotenv, repoRoot, requireEnv } from '../packages/shared/src/config.js';

const BASESCAN = 'https://sepolia.basescan.org';
const CHAIN_ID = 84532;
const SKILL = 'market-analysis';

export const REJECTION_NAMES: Record<number, string> = {
  0: 'OK',
  1: 'Expired',
  2: 'AlreadyVerified',
  3: 'BadClientSig',
  4: 'BadEnclaveSig',
  5: 'MatchFalse',
};

export interface DemoOptions {
  fraudMode?: FraudMode;
  nonce?: bigint;
  brief?: string;
  data?: string;
  /** Zincire yazmadan sadece akışı koştur (previewJob ile kodu okur). */
  dryRun?: boolean;
  /**
   * Ödeme rayı. Verilmezse PAYMENT_BACKEND env'i, o da yoksa ödeme adımı atlanır.
   * Kural: settlement YALNIZCA JobVerified'tan sonra — fraud koşusunda hiç çağrılmaz.
   */
  paymentRail?: 'hedera' | 'base' | 'none';
  /** HCS zaman çizelgesi. Varsayılan açık; latency ölçen kapılar kapatabilir. */
  timeline?: boolean;
  log?: (line: string) => void;
}

export interface DemoReport {
  fraudMode: FraudMode;
  /** Alice'in imzaladığı taahhüt. */
  signedIntentHash: string;
  /** Enclave'in gövdeye yazdığı taahhüt (fraud'da farklı olabilir). */
  bodyIntentHash: string;
  match: boolean;
  clientSigOk: boolean;
  bindingSigOk: boolean;
  computeProvider: string;
  ogVerified: boolean;
  /** Alice'in çözüp okuduğu çıktı. */
  output: string;
  /** Kontratın verdiği karar kodu. */
  code: number;
  codeName: string;
  verified: boolean;
  txHash?: string;
  blockNumber?: number;
  basescanUrl?: string;
  /** Alice'in ilk isteğinden zincirdeki karara kadar geçen süre. */
  totalMs: number;
  /**
   * P0-G: sürenin aşamalara dağılımı. Alice'in gördüğü aşamalar + enclave'in
   * İÇ aşamaları (`enclave_*` önekiyle) + zincir onayı.
   *
   * `http_task_work` Bob'un tüm işini kapsar; `enclave_*` onun içini açar.
   * İkisi ÜST ÜSTE binmez diye toplamı almıyoruz — baskın kalemi arıyoruz.
   */
  stageMs: StageMs;
  discoveredAgentId?: string;
  /** Ödeme sonucu. Fraud koşusunda `settled: false` ve `receipt` YOK. */
  payment?: {
    rail: string;
    quoted: boolean;
    authorized: boolean;
    settled: boolean;
    /** Neden settle edilmedi — fraud koşusunda burası dolu olur. */
    skippedReason?: string;
    txRef?: string;
    explorerUrl?: string;
  };
  /** HCS zaman çizelgesi sonucu. */
  timeline?: {
    topicId: string;
    hashscanUrl: string;
    /** Yazılan aşamalar, gönderim sırasıyla. */
    stages: string[];
  };
}

let cachedBob: BobAgent | undefined;

/** HCS zaman çizelgesini aç. Sırları verip kaza eseri sızıntıyı ağa çıkmadan yakalat. */
async function openTimeline(brief: string, data: string, log: (l: string) => void) {
  const cfg = loadConfig();
  const topicId = process.env.HEDERA_TOPIC_ID;
  if (!topicId) {
    log('[hcs] HEDERA_TOPIC_ID boş — zaman çizelgesi atlandı');
    return undefined;
  }
  const { createHcsTimeline } = await import('../packages/payment/src/hcs-timeline.js');
  const { createHederaOperatorClient } = await import('../packages/payment/src/signer/hedera-signer.js');
  return createHcsTimeline({
    client: createHederaOperatorClient({ accountId: cfg.HEDERA_OPERATOR_ID }),
    topicId,
    secrets: [brief, data],
    log,
  });
}

/**
 * Ödeme backend'i kur. AYNI fabrikayı hem Bob (doğrulama+settle) hem Alice
 * (yetkilendirme) kullanıyor — ray farkı Alice'in kodunda görünmüyor (P4-A kriteri).
 */
export async function makePaymentBackend(rail: 'hedera' | 'base', forBob: boolean) {
  const cfg = loadConfig();
  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const verifierAddress = requireEnv('VERIFIER_ADDRESS');
  if (rail === 'hedera') {
    const { createHederaX402Backend } = await import('../packages/payment/src/hedera-x402.js');
    const { createHederaSigner } = await import('../packages/payment/src/signer/hedera-signer.js');
    return createHederaX402Backend({
      signer: createHederaSigner({ accountId: cfg.HEDERA_OPERATOR_ID }),
      facilitatorUrl: cfg.BLOCKY402_URL,
      verifierProvider: provider,
      verifierAddress,
      payoutAccountId: forBob ? process.env.BOB_HEDERA_ACCOUNT : undefined,
    });
  }
  const { createBaseStealthBackend } = await import('../packages/payment/src/base-stealth.js');
  const { deriveAgentStealthKeys } = await import('../packages/payment/src/stealth.js');
  const bobKeys = deriveAgentStealthKeys(cfg.PRIVATE_KEY_BOB, 'bob');
  return createBaseStealthBackend({
    provider,
    payerPrivateKey: cfg.PRIVATE_KEY_ALICE,
    relayerPrivateKey: cfg.PRIVATE_KEY_DEPLOYER,
    usdcAddress: cfg.USDC_BASE_SEPOLIA,
    verifierAddress,
    recipientMetaAddress: bobKeys.metaAddress,
    // Bob tarafı: gelen ödemenin KENDİSİNE ait olduğunu doğrulamak için.
    viewingPrivateKey: forBob ? bobKeys.viewingPrivateKey : undefined,
    spendingPublicKey: forBob ? bobKeys.spendingPublicKey : undefined,
  });
}

/** Bob'u zincirde kayıtlı endpoint'inin portunda ayağa kaldır (bir kez). */
export async function ensureBob(log: (l: string) => void, rail: 'hedera' | 'base' | 'none' = 'none'): Promise<BobAgent> {
  if (cachedBob) return cachedBob;
  loadDotenv();
  const cfg = loadConfig();

  const { identityRegistry, readUtf8Metadata, METADATA_KEYS } = await import('../packages/shared/src/index.js');
  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const agentId = requireEnv('BOB_AGENT_ID');
  const endpoint = await readUtf8Metadata(registry, agentId, METADATA_KEYS.endpoint);
  if (!endpoint) throw new Error('Bob\'un zincirde endpoint metadata\'sı yok — pnpm gate:P2-A');

  const { backend: computeBackend, reason: computeReason } = await selectComputeBackend(process.env, {
    fixtureDir: resolve(repoRoot(), 'fixtures/og'),
    recordDir: resolve(repoRoot(), 'fixtures/og'),
  });
  log(`[demo] compute: ${computeReason}`);

  const url = new URL(endpoint);
  cachedBob = createBobAgent({
    eciesPrivateKey: requireEnv('BOB_ECIES_PRIV'),
    agentId,
    owner: new ethers.Wallet(cfg.PRIVATE_KEY_BOB).address,
    skills: [SKILL],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract: requireEnv('VERIFIER_ADDRESS'),
    chainId: CHAIN_ID,
    bindingKey: ethers.keccak256(ethers.toUtf8Bytes(`phase1-binding-key/${cfg.PRIVATE_KEY_BOB}`)),
    port: Number(url.port || 80),
    publicUrl: `${url.protocol}//${url.host}`,
    fraudMode: 'none',
    hederaAccount: process.env.BOB_HEDERA_ACCOUNT,
    // ÖDEME KAPISI: yetki olmadan iş yok. Yetkiyi Bob tutar, JobVerified sonrası
    // POST /settle ile kendisi gönderir (CLAUDE.md §7).
    payment:
      rail === 'none'
        ? undefined
        : {
            backend: await makePaymentBackend(rail, true),
            recipient:
              rail === 'hedera'
                ? (process.env.BOB_HEDERA_ACCOUNT ?? cfg.HEDERA_OPERATOR_ID)
                : deriveAgentStealthKeys(cfg.PRIVATE_KEY_BOB, 'bob').metaAddress,
            network: rail === 'hedera' ? 'hedera:testnet' : 'base-sepolia',
          },
    // Bob'un ERC-5564 meta-adresi kök cüzdanından DETERMİNİSTİK türetiliyor —
    // ayrı sır saklamak gerekmiyor, meta-adres her koşuda aynı.
    stealthMetaAddress: deriveAgentStealthKeys(cfg.PRIVATE_KEY_BOB, 'bob').metaAddress,
    // Modelin nerede koştuğu ORTAMDAN seçiliyor; hangisi seçilirse seçilsin
    // sonuç kendini doğru etiketliyor (none / fixture-replay / 0g-sealed-inference).
    compute: computeBackend,
    log: () => {},
  });
  await cachedBob.listen();
  log(`[demo] Bob ayakta: ${cachedBob.url()} (agentId ${agentId})`);
  return cachedBob;
}

export async function closeBob(): Promise<void> {
  await cachedBob?.close();
  cachedBob = undefined;
}

export async function runDemo(options: DemoOptions = {}): Promise<DemoReport> {
  loadDotenv();
  const cfg = loadConfig();
  const root = repoRoot();
  const log = options.log ?? ((l: string) => console.log(l));
  const fraudMode = options.fraudMode ?? 'none';

  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const alice = new ethers.Wallet(cfg.PRIVATE_KEY_ALICE, provider);
  const verifierAddress = requireEnv('VERIFIER_ADDRESS');
  const abi = (
    JSON.parse(readFileSync(resolve(root, 'contracts/out/Verifier.sol/Verifier.json'), 'utf8')) as {
      abi: ethers.InterfaceAbi;
    }
  ).abi;
  const verifier = new ethers.Contract(verifierAddress, abi, alice);

  const rail = options.paymentRail ?? (process.env.PAYMENT_BACKEND as DemoOptions['paymentRail']) ?? 'none';
  const bob = await ensureBob(log, rail);
  bob.setFraudMode(fraudMode);

  const constraints: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };
  const brief = options.brief ?? 'Assess revenue-recognition risk in the attached quarterly figures.';
  const data = options.data ?? 'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR; 41 contracts.';
  const nonce = options.nonce ?? BigInt(Date.now());

  const started = Date.now();
  const sw = createStopwatch();

  // --- 0. Zaman çizelgesi (HCS) — HER koşuda yazılır ---
  // "Hedera = the timeline" ancak ödeme rayından bağımsız yazarsak doğru olur.
  // İçerik değil TAAHHÜT gider; brief/veri/çıktı topic'e asla çıkmaz.
  const timeline = options.timeline === false ? undefined : await openTimeline(brief, data, log);
  sw.mark('hcs_open_topic');

  // --- 1-5. Keşif → intent → ECIES → Bob → enclave → Alice çözer ---
  const job = await runAliceJob({
    discover: { subgraphUrl: requireEnv('SUBGRAPH_QUERY_URL'), skill: SKILL },
    brief,
    data,
    constraints,
    wallet: alice,
    eciesPrivateKey: requireEnv('ALICE_ECIES_PRIV'),
    verifyingContract: verifierAddress,
    chainId: CHAIN_ID,
    nonce,
    payment: rail === 'none' ? undefined : { backend: await makePaymentBackend(rail, false) },
    log,
  });

  sw.mark('alice_job_total');

  const result: EchoResult = job.result;
  // Alice, zincire gönderilecek alanları Bob'un SÖZÜNDEN değil, enclave'in
  // İMZALADIĞI gövdeden çözer.
  // Zincire giden, Bob'un İDDİA ETTİĞİ gövdedir — enclave'in Alice'e şifrelediği
  // kopya değil. `forge` modunda ikisi ayrışır ve fark tam da orada görünür.
  const body = decodeBody(job.claimedBodyHex);

  log(
    `[demo] enclave: match=${body.match} · ${describeCompute({ provider: result.computeProvider, ogVerified: result.ogVerified })}`,
  );

  // --- Zaman çizelgesi: 402 → intent → enclave → çıktı ---
  // Sıra mantıksal sıradır; consensus sırası gönderim sırasını izler.
  const agentIdDecimal = BigInt(job.intent.agentId).toString();
  timeline?.record({
    v: 1,
    stage: '402_ISSUED',
    intentHash: job.intent.intentHash,
    by: 'agent',
    price: job.card.price.amount,
    currency: job.card.price.asset,
    rail: (options.paymentRail ?? process.env.PAYMENT_BACKEND ?? 'none') as string,
  });
  timeline?.record({
    v: 1,
    stage: 'INTENT_COMMIT',
    intentHash: job.intent.intentHash,
    by: 'client',
    client: job.intent.client,
    agentId: agentIdDecimal,
    deadline: job.intent.deadline.toString(),
  });
  timeline?.record({
    v: 1,
    stage: 'ENCLAVE_INVOKED',
    intentHash: job.intent.intentHash,
    by: 'agent',
    agentId: agentIdDecimal,
    // Ölçülmüş bir imaj yok — UYDURMUYORUZ. Gerçek Tapp gelince dolar.
    imageHash: null,
    attestation: 'none',
    // Elimizde GERÇEKTEN olan şey: gövdeyi imzalayan anahtar.
    bindingSigner: result.bindingSigner,
  });
  timeline?.record({
    v: 1,
    stage: 'OUTPUT_COMMIT',
    intentHash: job.intent.intentHash,
    by: 'agent',
    outputHash: body.outputHash,
    // Hile yapılsa bile buraya GERÇEK sonuç yazılır — red de zaman çizelgesinde.
    match: body.match,
    ogVerified: result.ogVerified,
    computeProvider: result.computeProvider,
  });

  // --- 6. Zincire götür ---
  const intent = {
    intentHash: body.intentHash, // fraud'da Bob'un uydurduğu hash olabilir
    client: job.intent.client,
    agentId: job.intent.agentId,
    price: job.intent.price,
    deadline: job.intent.deadline,
  };
  const seal = {
    agentId: job.claimedSeal.agentId,
    sealId: job.claimedSeal.sealId,
    timestamp: job.claimedSeal.timestamp,
    r: job.claimedSeal.r,
    s: job.claimedSeal.s,
  };
  const args = [intent, job.signature, body.outputHash, body.match, body.ogSigHash, seal] as const;

  const code = Number((await verifier.previewJob(...args)) as bigint);
  const codeName = REJECTION_NAMES[code] ?? `Unknown(${code})`;

  const report: DemoReport = {
    fraudMode,
    signedIntentHash: job.intent.intentHash,
    bodyIntentHash: body.intentHash,
    match: body.match,
    clientSigOk: result.clientSigOk,
    bindingSigOk: result.bindingSigOk,
    computeProvider: result.computeProvider,
    ogVerified: result.ogVerified,
    output: result.output,
    code,
    codeName,
    verified: code === 0,
    totalMs: 0,
    stageMs: {},
    discoveredAgentId: job.discovered?.agentId,
  };

  const collectStages = (): StageMs => ({
    ...job.stageMs,
    // Enclave'in İÇ dağılımı — `http_task_work` kaleminin içini açar.
    ...Object.fromEntries(
      Object.entries(result.stageMs ?? {}).map(([k, v]) => [`enclave_${k}`, v]),
    ),
    ...sw.stages(),
  });

  if (options.dryRun) {
    report.totalMs = Date.now() - started;
    report.stageMs = collectStages();
    return report;
  }

  // Dürüst iş KATI yolu kullanır (settlement bunu okuyacak).
  // Fraud MÜSAMAHALI yolu kullanır: revert etmez, JobRejected yayar, subgraph
  // indeksler ve Basescan'de başarılı görünür (BUILD-PLAN P3-A gerekçesi).
  const tx = code === 0 ? await verifier.verifyJob(...args) : await verifier.verifyJobLenient(...args);
  const receipt = await tx.wait();
  sw.mark('chain_verify_tx');
  report.totalMs = Date.now() - started;
  report.stageMs = collectStages();
  report.txHash = tx.hash;
  report.blockNumber = receipt?.blockNumber;
  report.basescanUrl = `${BASESCAN}/tx/${tx.hash}`;

  log(
    `[demo] zincir: ${code === 0 ? 'JobVerified' : `JobRejected(${codeName})`} · blok ${receipt?.blockNumber} · ${report.totalMs} ms`,
  );
  log(`[demo] ${report.basescanUrl}`);

  // --- 7. SETTLEMENT — BOB tetikler, yalnızca JobVerified'tan SONRA ---
  if (rail !== 'none') {
    report.payment = await settleViaBob(bob.url(), job, report, log);
  }

  // SETTLED yalnızca gerçekten settle olduysa yazılır. Fraud koşusunda bu satır
  // hiç çalışmaz — zaman çizelgesinde de "ödeme olmadı" görünür.
  if (report.payment?.settled && report.payment.txRef && report.txHash) {
    timeline?.record({
      v: 1,
      stage: 'SETTLED',
      intentHash: job.intent.intentHash,
      by: 'client',
      rail: report.payment.rail,
      txId: report.payment.txRef,
      jobVerifiedTx: report.txHash,
    });
  }

  if (timeline) {
    const written = await timeline.flush();
    timeline.close();
    report.timeline = {
      topicId: timeline.topicId,
      hashscanUrl: timeline.hashscanUrl,
      stages: written.map((w) => w.event.stage),
    };
    log(`[hcs] zaman çizelgesi: ${report.timeline.stages.join(' → ')}`);
  }

  return report;
}

/**
 * Settlement'ı BOB tetikler — ekonomik teşvik onda: JobVerified olmadan parasını alamıyor.
 *
 * Yetki zaten Bob'da (402 kapısından geçerken bıraktık). Fraud koşusunda JobVerified
 * hiç oluşmaz, dolayısıyla bu çağrı 402 ile döner ve para HİÇ hareket etmez.
 */
async function settleViaBob(
  bobUrl: string,
  job: Awaited<ReturnType<typeof runAliceJob>>,
  report: DemoReport,
  log: (l: string) => void,
): Promise<DemoReport['payment']> {
  const rail = job.paymentRequired ? 'x402' : 'none';

  // KURAL: doğrulanmamış iş için settle YOK. Fraud koşusu buradan döner ve
  // Bob'un elindeki yetki HİÇ gönderilmez — "ödeme asla settle olmadı".
  if (!report.verified || !report.txHash) {
    log(`[demo] ÖDEME SETTLE EDİLMEDİ — iş doğrulanmadı (${report.codeName})`);
    return {
      rail,
      quoted: true,
      authorized: job.paymentRequired,
      settled: false,
      skippedReason: `JobVerified yok (${report.codeName})`,
    };
  }

  const res = await fetch(`${bobUrl}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intentHash: job.intent.intentHash, jobVerifiedTx: report.txHash }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log(`[demo] settle reddedildi (HTTP ${res.status}): ${body.slice(0, 120)}`);
    return { rail, quoted: true, authorized: true, settled: false, skippedReason: `HTTP ${res.status}` };
  }
  const { receipt } = (await res.json()) as { receipt: { rail: string; txRef: string; explorerUrl: string } };
  log(`[demo] ödeme settle oldu: ${receipt.explorerUrl}`);
  return {
    rail: receipt.rail,
    quoted: true,
    authorized: true,
    settled: true,
    txRef: receipt.txRef,
    explorerUrl: receipt.explorerUrl,
  };
}

/** `pnpm demo:base` girişi. */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args[args.indexOf('--fraud') + 1];
  const fraudMode = (args.includes('--fraud') ? modeArg : 'none') as FraudMode;

  console.log(`\n=== Confidential Agents · uçtan uca demo (fraud: ${fraudMode}) ===\n`);
  const report = await runDemo({ fraudMode });
  await closeBob();

  console.log('\n--- Alice ne gördü ---');
  console.log(`keşif        : The Graph → agentId ${report.discoveredAgentId} (adres verilmedi)`);
  console.log(`imzalanan    : ${report.signedIntentHash}`);
  console.log(`enclave gövde: ${report.bodyIntentHash}`);
  console.log(`match        : ${report.match}`);
  console.log(`compute      : ${report.computeProvider} · ogVerified=${report.ogVerified}`);
  console.log(`çıktı        : ${report.output.slice(0, 120)}${report.output.length > 120 ? '…' : ''}`);
  console.log('\n--- Zincir ne dedi ---');
  console.log(`karar        : ${report.codeName}${report.verified ? '' : '  (REDDEDİLDİ)'}`);
  console.log(`tx           : ${report.basescanUrl ?? '-'}`);
  console.log(`süre         : ${report.totalMs} ms\n`);

  if (!report.verified && fraudMode === 'none') process.exit(1);
}
