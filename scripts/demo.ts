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
import { describeCompute, type Constraints, type EchoResult } from '../packages/shared/src/index.js';
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
}

let cachedBob: BobAgent | undefined;

/** Bob'u zincirde kayıtlı endpoint'inin portunda ayağa kaldır (bir kez). */
export async function ensureBob(log: (l: string) => void): Promise<BobAgent> {
  if (cachedBob) return cachedBob;
  loadDotenv();
  const cfg = loadConfig();

  const { identityRegistry, readUtf8Metadata, METADATA_KEYS } = await import('../packages/shared/src/index.js');
  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const agentId = requireEnv('BOB_AGENT_ID');
  const endpoint = await readUtf8Metadata(registry, agentId, METADATA_KEYS.endpoint);
  if (!endpoint) throw new Error('Bob\'un zincirde endpoint metadata\'sı yok — pnpm gate:P2-A');

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

  const bob = await ensureBob(log);
  bob.setFraudMode(fraudMode);

  const constraints: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };
  const brief = options.brief ?? 'Assess revenue-recognition risk in the attached quarterly figures.';
  const data = options.data ?? 'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR; 41 contracts.';
  const nonce = options.nonce ?? BigInt(Date.now());

  const started = Date.now();

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
    log,
  });

  const result: EchoResult = job.result;
  // Alice, zincire gönderilecek alanları Bob'un SÖZÜNDEN değil, enclave'in
  // İMZALADIĞI gövdeden çözer.
  const body = decodeBody(result.bodyHex);

  log(
    `[demo] enclave: match=${body.match} · ${describeCompute({ provider: result.computeProvider, ogVerified: result.ogVerified })}`,
  );

  // --- 6. Zincire götür ---
  const intent = {
    intentHash: body.intentHash, // fraud'da Bob'un uydurduğu hash olabilir
    client: job.intent.client,
    agentId: job.intent.agentId,
    price: job.intent.price,
    deadline: job.intent.deadline,
  };
  const seal = {
    agentId: result.seal.agentId,
    sealId: result.seal.sealId,
    timestamp: result.seal.timestamp,
    r: result.seal.r,
    s: result.seal.s,
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
    discoveredAgentId: job.discovered?.agentId,
  };

  if (options.dryRun) {
    report.totalMs = Date.now() - started;
    return report;
  }

  // Dürüst iş KATI yolu kullanır (settlement bunu okuyacak).
  // Fraud MÜSAMAHALI yolu kullanır: revert etmez, JobRejected yayar, subgraph
  // indeksler ve Basescan'de başarılı görünür (BUILD-PLAN P3-A gerekçesi).
  const tx = code === 0 ? await verifier.verifyJob(...args) : await verifier.verifyJobLenient(...args);
  const receipt = await tx.wait();
  report.totalMs = Date.now() - started;
  report.txHash = tx.hash;
  report.blockNumber = receipt?.blockNumber;
  report.basescanUrl = `${BASESCAN}/tx/${tx.hash}`;

  log(
    `[demo] zincir: ${code === 0 ? 'JobVerified' : `JobRejected(${codeName})`} · blok ${receipt?.blockNumber} · ${report.totalMs} ms`,
  );
  log(`[demo] ${report.basescanUrl}`);

  // --- 7. ÖDEME — yalnızca JobVerified'tan SONRA ---
  const rail = options.paymentRail ?? (process.env.PAYMENT_BACKEND as DemoOptions['paymentRail']) ?? 'none';
  if (rail !== 'none') {
    report.payment = await runPayment(rail, job, report, log);
  }

  return report;
}

/**
 * Ödeme akışı: quote → authorize (para HAREKET ETMEZ) → settle (JobVerified'tan SONRA).
 *
 * Fraud koşusunda `JobVerified` hiç oluşmadığı için `settle()` HİÇ ÇAĞRILMIYOR.
 * Demonun en güçlü cümlesi bu: "ödeme asla settle olmadı."
 */
async function runPayment(
  rail: 'hedera' | 'base',
  job: Awaited<ReturnType<typeof runAliceJob>>,
  report: DemoReport,
  log: (l: string) => void,
): Promise<DemoReport['payment']> {
  const cfg = loadConfig();
  const { createHederaX402Backend } = await import('../packages/payment/src/hedera-x402.js');
  const { createBaseStealthBackend } = await import('../packages/payment/src/base-stealth.js');
  const { createHederaSigner } = await import('../packages/payment/src/signer/hedera-signer.js');
  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const verifierAddress = requireEnv('VERIFIER_ADDRESS');

  const backend =
    rail === 'hedera'
      ? createHederaX402Backend({
          // Anahtar BURAYA GİRMİYOR — delegated signer env'den kendisi okuyor.
          signer: createHederaSigner({ accountId: cfg.HEDERA_OPERATOR_ID }),
          facilitatorUrl: cfg.BLOCKY402_URL,
          verifierProvider: provider,
          verifierAddress,
        })
      : createBaseStealthBackend({
          provider,
          payerPrivateKey: cfg.PRIVATE_KEY_ALICE,
          usdcAddress: cfg.USDC_BASE_SEPOLIA,
          verifierAddress,
        });

  const recipient =
    rail === 'hedera'
      ? (job.card.hederaAccount ?? requireEnv('HEDERA_OPERATOR_ID'))
      : (job.card.stealthMetaAddress ?? '');

  const quote = await backend.quote({
    intentHash: job.intent.intentHash,
    amount: job.card.price.amount,
    recipient,
  });
  const proof = await backend.authorize(quote);
  log(`[demo] ödeme yetkilendirildi (${backend.rail}) — para HENÜZ hareket etmedi`);

  // KURAL: doğrulanmamış iş için settle YOK.
  if (!report.verified || !report.txHash) {
    log(`[demo] ÖDEME SETTLE EDİLMEDİ — iş doğrulanmadı (${report.codeName})`);
    return {
      rail: backend.rail,
      quoted: true,
      authorized: true,
      settled: false,
      skippedReason: `JobVerified yok (${report.codeName})`,
    };
  }

  const receipt = await backend.settle(proof, report.txHash);
  log(`[demo] ödeme settle oldu: ${receipt.explorerUrl}`);
  return {
    rail: backend.rail,
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
