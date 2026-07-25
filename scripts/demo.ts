// scripts/demo.ts — the end-to-end hero flow (BUILD-PLAN P3-D).
//
//   Alice → discovery (The Graph) → intent (EIP-712) → ECIES → Bob → binding (enclave)
//         → seal signature → Alice decrypts → verifyJob → JobVerified (Base Sepolia)
//
// Tek komut: `pnpm demo:base`
//
// The fraud modes take the same path; only Bob's OUTER layer cheats — the enclave is honest
// under every condition. The contract issues the rejection.
//
// Critical design point: Alice takes the `intentHash` she submits on chain from THE BODY THE
// ENCLAVE SIGNED, not from Bob's WORD. That makes a "Bob invented his own job" scenario such
// as `selfintent` realistic: the fabricated hash is in the body, Alice's signature does not
// belong to it, and the contract returns `BadClientSig`.

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
  /** Run the flow without writing on chain (reads the code via previewJob). */
  dryRun?: boolean;
  /**
   * The payment rail. When absent, the PAYMENT_BACKEND env is used; without that the payment
   * step is skipped. Rule: settlement ONLY after JobVerified — never called on a fraud run.
   */
  paymentRail?: 'hedera' | 'base' | 'none';
  /** The HCS timeline. On by default; latency-measuring gates may turn it off. */
  timeline?: boolean;
  log?: (line: string) => void;
}

export interface DemoReport {
  fraudMode: FraudMode;
  /** The commitment Alice signed. */
  signedIntentHash: string;
  /** The commitment the enclave wrote into the body (may differ under fraud). */
  bodyIntentHash: string;
  match: boolean;
  clientSigOk: boolean;
  bindingSigOk: boolean;
  computeProvider: string;
  ogVerified: boolean;
  /** The output Alice decrypted and read. */
  output: string;
  /** The verdict code the contract returned. */
  code: number;
  codeName: string;
  verified: boolean;
  txHash?: string;
  blockNumber?: number;
  basescanUrl?: string;
  /** The time from Alice's first request to the verdict on chain. */
  totalMs: number;
  /**
   * P0-G: the distribution of the elapsed time across stages. The stages Alice sees + the
   * enclave's INTERNAL stages (prefixed `enclave_`) + the chain confirmation.
   *
   * `http_task_send*` wraps all of Bob's work; `enclave_*` opens it up.
   * Because the two OVERLAP we do not sum them — we look for the dominant line item.
   */
  stageMs: StageMs;
  discoveredAgentId?: string;
  /** The payment outcome. On a fraud run `settled: false` and there is NO receipt. */
  payment?: {
    rail: string;
    quoted: boolean;
    authorized: boolean;
    settled: boolean;
    /** Why it did not settle — populated on a fraud run. */
    skippedReason?: string;
    txRef?: string;
    explorerUrl?: string;
  };
  /** The HCS timeline outcome. */
  timeline?: {
    topicId: string;
    hashscanUrl: string;
    /** The stages written, in submission order. */
    stages: string[];
  };
}

let cachedBob: BobAgent | undefined;

/** Open the HCS timeline. Pass the secrets so an accidental leak is caught before the network. */
async function openTimeline(brief: string, data: string, log: (l: string) => void) {
  const cfg = loadConfig();
  const topicId = process.env.HEDERA_TOPIC_ID;
  if (!topicId) {
    log('[hcs] HEDERA_TOPIC_ID is empty — timeline skipped');
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
 * Build the payment backend. The SAME factory serves Bob (verify+settle) and Alice
 * (authorise) — the rail difference is invisible in Alice's code (a P4-A criterion).
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
    // The Bob side: for verifying that an incoming payment is HIS.
    viewingPrivateKey: forBob ? bobKeys.viewingPrivateKey : undefined,
    spendingPublicKey: forBob ? bobKeys.spendingPublicKey : undefined,
  });
}

/** Bring Bob up on the port of his on-chain registered endpoint (once). */
export async function ensureBob(log: (l: string) => void, rail: 'hedera' | 'base' | 'none' = 'none'): Promise<BobAgent> {
  if (cachedBob) return cachedBob;
  loadDotenv();
  const cfg = loadConfig();

  const { identityRegistry, readUtf8Metadata, METADATA_KEYS } = await import('../packages/shared/src/index.js');
  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const agentId = requireEnv('BOB_AGENT_ID');
  const endpoint = await readUtf8Metadata(registry, agentId, METADATA_KEYS.endpoint);
  if (!endpoint) throw new Error('Bob has no endpoint metadata on chain — run pnpm gate:P2-A');

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
    // THE PAYMENT GATE: no authorisation, no work. Bob holds the authorisation and submits it
    // himself via POST /settle after JobVerified (CLAUDE.md §7).
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
    // Bob's ERC-5564 meta-address is derived DETERMINISTICALLY from his root wallet — no separate
    // secret to store, and the meta-address is identical on every run.
    stealthMetaAddress: deriveAgentStealthKeys(cfg.PRIVATE_KEY_BOB, 'bob').metaAddress,
    // Where the model runs is chosen FROM THE ENVIRONMENT; whichever is selected, the result
    // labels itself correctly (none / fixture-replay / 0g-sealed-inference).
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

  // --- 0. The timeline (HCS) — written on EVERY run ---
  // "Hedera = the timeline" is only true if we write it independently of the payment rail.
  // COMMITMENTS go, not content; brief/data/output never reach the topic.
  const timeline = options.timeline === false ? undefined : await openTimeline(brief, data, log);
  sw.mark('hcs_open_topic');

  // --- 1-5. Discovery → intent → ECIES → Bob → enclave → Alice decrypts ---
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
  // Alice decodes the fields going on chain from the body the enclave SIGNED, not from Bob's
  // WORD.
  // What goes on chain is the body Bob CLAIMS — not the copy the enclave encrypted to Alice.
  // In `forge` mode the two diverge, and that is exactly where the difference shows.
  const body = decodeBody(job.claimedBodyHex);

  log(
    `[demo] enclave: match=${body.match} · ${describeCompute({ provider: result.computeProvider, ogVerified: result.ogVerified })}`,
  );

  // --- Timeline: 402 → intent → enclave → output ---
  // The order is the logical order; consensus order follows submission order.
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
    // There is no measured image — WE DO NOT FABRICATE ONE. It fills in with a real Tapp.
    imageHash: null,
    attestation: 'none',
    // What we ACTUALLY have: the key that signed the body.
    bindingSigner: result.bindingSigner,
  });
  timeline?.record({
    v: 1,
    stage: 'OUTPUT_COMMIT',
    intentHash: job.intent.intentHash,
    by: 'agent',
    outputHash: body.outputHash,
    // Even under fraud the REAL outcome is written here — the rejection is in the timeline too.
    match: body.match,
    ogVerified: result.ogVerified,
    computeProvider: result.computeProvider,
  });

  // --- 6. Take it to the chain ---
  const intent = {
    intentHash: body.intentHash, // under fraud this may be the hash Bob fabricated
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
    // The enclave's INTERNAL breakdown — it opens up the `http_task_send*` line item.
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

  // An honest job uses the STRICT path (settlement will read it).
  // Fraud uses the LENIENT path: it does not revert, it emits JobRejected, the subgraph indexes
  // it and it appears successful on Basescan (the BUILD-PLAN P3-A rationale).
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

  // --- 7. SETTLEMENT — BOB triggers it, and only AFTER JobVerified ---
  if (rail !== 'none') {
    report.payment = await settleViaBob(bob.url(), job, report, log);
  }

  // SETTLED is written only if settlement actually happened. On a fraud run this line never
  // executes — so the timeline also shows "no payment".
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
    log(`[hcs] timeline: ${report.timeline.stages.join(' → ')}`);
  }

  return report;
}

/**
 * BOB triggers settlement — the economic incentive is his: without JobVerified he does not get
 * paid.
 *
 * The authorisation is already with Bob (left there when passing the 402 gate). On a fraud run
 * JobVerified never appears, so this call returns 402 and NO money moves at all.
 */
async function settleViaBob(
  bobUrl: string,
  job: Awaited<ReturnType<typeof runAliceJob>>,
  report: DemoReport,
  log: (l: string) => void,
): Promise<DemoReport['payment']> {
  const rail = job.paymentRequired ? 'x402' : 'none';

  // THE RULE: NO settle for an unverified job. The fraud run turns back here and the
  // authorisation in Bob's hands is NEVER submitted — "the payment never settled".
  if (!report.verified || !report.txHash) {
    log(`[demo] PAYMENT NOT SETTLED — the job was not verified (${report.codeName})`);
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
  log(`[demo] payment settled: ${receipt.explorerUrl}`);
  return {
    rail: receipt.rail,
    quoted: true,
    authorized: true,
    settled: true,
    txRef: receipt.txRef,
    explorerUrl: receipt.explorerUrl,
  };
}

/** The `pnpm demo:base` entry point. */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args[args.indexOf('--fraud') + 1];
  const fraudMode = (args.includes('--fraud') ? modeArg : 'none') as FraudMode;

  console.log(`\n=== Confidential Agents · end-to-end demo (fraud: ${fraudMode}) ===\n`);
  const report = await runDemo({ fraudMode });
  await closeBob();

  console.log('\n--- what Alice saw ---');
  console.log(`discovery    : The Graph → agentId ${report.discoveredAgentId} (no address supplied)`);
  console.log(`imzalanan    : ${report.signedIntentHash}`);
  console.log(`enclave body : ${report.bodyIntentHash}`);
  console.log(`match        : ${report.match}`);
  console.log(`compute      : ${report.computeProvider} · ogVerified=${report.ogVerified}`);
  console.log(`output       : ${report.output.slice(0, 120)}${report.output.length > 120 ? '…' : ''}`);
  console.log('\n--- Zincir ne dedi ---');
  console.log(`verdict      : ${report.codeName}${report.verified ? '' : '  (REJECTED)'}`);
  console.log(`tx           : ${report.basescanUrl ?? '-'}`);
  console.log(`elapsed      : ${report.totalMs} ms\n`);

  if (!report.verified && fraudMode === 'none') process.exit(1);
}
