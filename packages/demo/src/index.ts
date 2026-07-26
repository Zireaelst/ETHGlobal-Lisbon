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
import { concat, ethers, getBytes } from 'ethers';

import { createBobAgent, type BobAgent } from '@ca/bob-agent';
import type { FraudMode } from '@ca/bob-agent/dist/fraud.js';
import { runAliceJob } from '@ca/alice-agent';
import { decodeBody } from '@ca/bob-binding';
import {
  describeCompute,
  describeReasoning,
  selectComputeBackend,
  selectStorageBackend,
  selectReasoningBackend,
  createStopwatch,
  recoverSealCandidates,
  sealDigest,
  type StageMs,
  type Constraints,
  type EchoResult,
  type HireDecision,
  type PriceDecision,
  type ReasoningProvider,
  type ResultDecision,
} from '@ca/shared';
import { deriveAgentStealthKeys } from '@ca/payment';
import { loadConfig, loadDotenv, repoRoot, requireEnv } from '@ca/shared';

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
  /**
   * P3-E: where the deliverable is archived on 0G Storage. PUBLIC HALF ONLY.
   *
   * The AES key is deliberately absent. This object is serialised into `fixtures/runs/*.json`,
   * which is tracked in git — putting the key here would publish the plaintext to anyone who
   * clones the repo and undo the very boundary the archive is meant to preserve. Alice keeps
   * the key in her own process; the gate reads it from her decrypted envelope.
   */
  storage?: { rootHash: string; txHash: string; bytes: number };
  /**
   * The job as Alice placed it — the confidential side of the split-screen panel.
   *
   * NEVER put these in the proof bundle: that file is meant to be handed to strangers, and the
   * entire claim of the confidentiality panel is that the brief and the data went nowhere the
   * enclave and Alice were not.
   */
  brief: string;
  data: string;
  /**
   * Everything a THIRD PARTY needs to recover the binding signature with plain `ethers` and no
   * code of ours. It carries no verdict: `expectedSigner` is what the contract has on file and
   * `recoveredCandidates` is what the signature actually yields, so the reader draws the
   * conclusion. Under `forge` the two disagree, which is the correct and visible outcome.
   *
   * Safe to serialise into the tracked fixtures: every field is already public on the wire or
   * on chain. The body is the abi-encoded commitment tuple, not the deliverable.
   */
  binding?: {
    agentId: string;
    sealId: string;
    timestamp: string;
    r: string;
    s: string;
    v: number;
    /** r‖s‖v, ready for `ethers.recoverAddress(sealDigest, seal)`. */
    seal: string;
    sealDigest: string;
    bodyHex: string;
    expectedSigner: string | null;
    recoveredCandidates: Array<{ v: number; address: string }>;
  };
  ogVerified: boolean;
  /**
   * WHO DECIDED — the counterpart to `computeProvider`, which says who COMPUTED.
   * Two independent questions, two independent labels; the dashboard shows both.
   */
  reasoningProvider: ReasoningProvider;
  /** The agents' own words at each decision point. Empty when they ran on the policy brain. */
  decisions?: {
    hire?: HireDecision;
    price?: PriceDecision;
    result?: ResultDecision;
  };
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
    /**
     * Who was actually paid, and who the agent is publicly known as. On the Base rail these
     * differ (a fresh stealth address per job); on Hedera they are the same published account.
     * Two values a reader can compare — not a `private: true` we would be asking them to believe.
     */
    paidTo?: string;
    agentIdentity?: string;
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
  const { createHcsTimeline } = await import('@ca/payment');
  const { createHederaOperatorClient } = await import('@ca/payment');
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
    const { createHederaX402Backend } = await import('@ca/payment/dist/hedera-x402.js');
    const { createHederaSigner } = await import('@ca/payment');
    return createHederaX402Backend({
      signer: createHederaSigner({ accountId: cfg.HEDERA_OPERATOR_ID }),
      facilitatorUrl: cfg.BLOCKY402_URL,
      verifierProvider: provider,
      verifierAddress,
      payoutAccountId: forBob ? process.env.BOB_HEDERA_ACCOUNT : undefined,
    });
  }
  const { createBaseStealthBackend } = await import('@ca/payment/dist/base-stealth.js');
  const { deriveAgentStealthKeys } = await import('@ca/payment');
  const bobKeys = deriveAgentStealthKeys(cfg.PRIVATE_KEY_BOB, 'bob');
  return createBaseStealthBackend({
    provider,
    payerPrivateKey: cfg.PRIVATE_KEY_ALICE,
    relayerPrivateKey: cfg.PRIVATE_KEY_DEPLOYER,
    usdcAddress: cfg.USDC_BASE_SEPOLIA,
    verifierAddress,
    recipientMetaAddress: bobKeys.metaAddress,
    // Bob's public identity, for the receipt to sit beside the address actually paid.
    agentIdentity: new ethers.Wallet(cfg.PRIVATE_KEY_BOB).address,
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

  const { identityRegistry, readUtf8Metadata, METADATA_KEYS } = await import('@ca/shared');
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

  // P3-E is opt-in (OG_STORAGE=1): every job it archives costs faucet credit, so a run that
  // did not ask for an archive is not billed for one.
  const storageBackend = selectStorageBackend(process.env);
  log(
    storageBackend
      ? '[demo] storage: OG_STORAGE=1 → the deliverable is archived on 0G Storage, encrypted'
      : '[demo] storage: off (OG_STORAGE is not 1) — no archive, and no root hash is invented',
  );

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
    storage: storageBackend ?? undefined,
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

  // Alice's brain. Chosen from the environment and labelled honestly, exactly like compute:
  // `policy` by default so the gates stay deterministic, `claude` for the live demo.
  // The 0G backend shares the compute boundary, hence the same `bob` selection is reused.
  const { backend: reasoning, reason: reasoningReason } = await selectReasoningBackend(process.env, {
    compute: (await selectComputeBackend(process.env, { fixtureDir: resolve(root, 'fixtures/og') })).backend,
    log,
  });
  log(`[demo] reasoning: ${reasoningReason}`);

  // --- 1-5. Discovery → intent → ECIES → Bob → enclave → Alice decrypts ---
  const job = await runAliceJob({
    reasoning,
    // Alice's ceiling: Bob quotes 1 USDC, she is authorised up to 5. The gap is what makes
    // the approval a real decision rather than a rubber stamp.
    maxPrice: 5_000_000n,
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

  // --- the material a STRANGER needs to recover the binding signature without us ---
  //
  // The proof bundle's whole promise is "nothing here asks you to trust us", and it was asking
  // exactly that: it printed a recover-it-yourself command against fields the report never
  // carried, so the command threw. Everything below is either already on the wire or derivable
  // from it — the digest ships beside the body it comes from, so the derivation is checkable too.
  //
  // `v` is brute-forced because the wrapper discards it (CLAUDE.md §3.1 B). We serialise the
  // candidate that yields the signer the CONTRACT has registered; when neither does — a forged
  // seal — we serialise v=27 anyway, and the recovered address then visibly differs from
  // `expectedSigner`. That difference IS the answer for a forged run, so producing it is the
  // honest outcome rather than an error.
  const sealFields = { agentId: seal.agentId, sealId: seal.sealId, timestamp: seal.timestamp };
  // Keyed by the INTENT's agentId (bytes32), which is what `_verify` looks the signer up by —
  // not by `seal.agentId`, which is the ASCII string folded into the preimage. They are two
  // different encodings of the same agent and only one of them is a valid mapping key.
  const registeredSigner: string | null = await verifier
    .getFunction('enclaveSignerOf')(intent.agentId)
    .then((a: unknown) => (a === ethers.ZeroAddress ? null : (a as string)))
    .catch(() => null);
  const candidates = recoverSealCandidates(sealFields, job.claimedBodyHex, seal.r, seal.s);
  const matchingV = registeredSigner
    ? (candidates.find((c) => c.address.toLowerCase() === registeredSigner.toLowerCase())?.v ?? null)
    : null;
  const binding = {
    ...sealFields,
    r: seal.r,
    s: seal.s,
    v: matchingV ?? 27,
    /** r‖s‖v, ready for `ethers.recoverAddress(sealDigest, seal)`. */
    seal: concat([getBytes(seal.r), getBytes(seal.s), new Uint8Array([matchingV ?? 27])]) as string,
    sealDigest: sealDigest(sealFields, job.claimedBodyHex),
    /** Included so the digest above can be recomputed rather than believed. */
    bodyHex: job.claimedBodyHex,
    /** What the Verifier has on file for this agent — the address a recovery must equal. */
    expectedSigner: registeredSigner,
    /** Whom the signature actually recovers to, for each parity. */
    recoveredCandidates: candidates,
  };

  // `getFunction` rather than `verifier.previewJob(...)`: ethers types dynamic contract members
  // as possibly-undefined, and this file is type-checked now that it is a package rather than a
  // loose script. Same call, minus a cast that would hide a genuine typo in the method name.
  const code = Number((await verifier.getFunction('previewJob')(...args)) as bigint);
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
    reasoningProvider: reasoning.provider,
    decisions: job.decisions,
    output: result.output,
    // What Alice actually ordered. Carried so the dashboard can SHOW the private side of the
    // job instead of hardcoding a copy of it — a copy that would keep rendering the old brief,
    // confidently and wrongly, the first time this demo is run with a different one.
    //
    // Alice's own record may hold these; the proof bundle must not, and does not.
    brief,
    data,
    binding,
    storage: result.storage
      ? { rootHash: result.storage.rootHash, txHash: result.storage.txHash, bytes: result.storage.bytes }
      : undefined,
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
  const method = code === 0 ? 'verifyJob' : 'verifyJobLenient';
  const tx = (await verifier.getFunction(method)(...args)) as ethers.ContractTransactionResponse;
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
    report.payment = await settleViaBob(bob.url(), job, report, log, rail);
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
  /**
   * The rail the OPERATOR chose. Previously this path reported the generic `x402` and the real
   * rail was recoverable only from a settlement URL — which a rejected run never has. The
   * dashboard then guessed, and guessed "Base" for every fraud run on Hedera. The rail is known
   * here, so it is reported here; a run that moved no money still moved it on a named rail.
   */
  chosenRail: 'hedera' | 'base' | 'none' = 'none',
): Promise<DemoReport['payment']> {
  const rail = job.paymentRequired ? chosenRail : 'none';

  // THE RULE: NO settle for an unverified job. The fraud run turns back here and the
  // authorisation in Bob's hands is NEVER submitted — "the payment never settled".
  if (!report.verified || !report.txHash) {
    log(`[demo] PAYMENT NOT SETTLED — the job was not verified (${report.codeName})`);
    return {
      rail,
      quoted: true,
      authorized: job.paymentRequired,
      settled: false,
      // Surfaced verbatim in the dashboard, so it is written in the language the rest of the
      // UI speaks. A judge reading "JobVerified yok" learns nothing from the sentence itself.
      skippedReason: `no JobVerified for this job (${report.codeName})`,
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
  const { receipt } = (await res.json()) as {
    receipt: { rail: string; txRef: string; explorerUrl: string; paidTo?: string; agentIdentity?: string };
  };
  log(`[demo] payment settled: ${receipt.explorerUrl}`);
  if (receipt.paidTo) {
    const named = receipt.paidTo.toLowerCase() === receipt.agentIdentity?.toLowerCase();
    log(
      `[demo] paid to ${receipt.paidTo} — ${
        named ? 'the agent\'s own published account' : `NOT the agent's registered ${receipt.agentIdentity}`
      }`,
    );
  }
  return {
    rail: receipt.rail,
    quoted: true,
    authorized: true,
    settled: true,
    txRef: receipt.txRef,
    explorerUrl: receipt.explorerUrl,
    paidTo: receipt.paidTo,
    agentIdentity: receipt.agentIdentity,
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
  console.log(`brain        : ${describeReasoning(report.reasoningProvider)}`);
  if (report.decisions?.hire) console.log(`  hire       : ${report.decisions.hire.rationale}`);
  if (report.decisions?.price) {
    console.log(
      `  price      : ${report.decisions.price.approve ? 'authorised' : 'DECLINED'} — ${report.decisions.price.rationale}`,
    );
  }
  if (report.decisions?.result) {
    console.log(
      `  review     : ${report.decisions.result.accept ? 'accepted' : 'rejected'} — ${report.decisions.result.rationale}`,
    );
  }
  console.log(`output       : ${report.output.slice(0, 120)}${report.output.length > 120 ? '…' : ''}`);
  if (report.storage) {
    // Only the address is printed. The key that opens it stayed in Alice's envelope.
    console.log(`archive      : 0G Storage ${report.storage.rootHash} · ${report.storage.bytes} bayt (şifreli)`);
  }
  console.log('\n--- Zincir ne dedi ---');
  console.log(`verdict      : ${report.codeName}${report.verified ? '' : '  (REJECTED)'}`);
  console.log(`tx           : ${report.basescanUrl ?? '-'}`);
  console.log(`elapsed      : ${report.totalMs} ms\n`);

  if (!report.verified && fraudMode === 'none') process.exit(1);
}
