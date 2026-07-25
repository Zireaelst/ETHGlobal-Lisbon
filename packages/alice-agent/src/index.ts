// alice-agent — istemci agent (BUILD-PLAN §2.1).
//
// PHASE 1 scope: fetch Bob's card → build the intent → sign with EIP-712 → ECIES-encrypt →
// POST to /task → read the result from /result → decrypt. Discovery (The Graph) arrives in
// P2-C, payment in P4.
//
// What Alice signs is NOT THE CONTENT but the `intentHash` commitment (BUILD-PLAN §2.3).
// If the commitment Bob recomputes does not match it, the job is not "the job that was ordered".

import {
  AgentCardSchema,
  EchoResultSchema,
  PLACEHOLDER_VERIFIER,
  type AgentCard,
  type Constraints,
  type EchoResult,
  type Intent,
  type PaymentAuthorization,
  type PaymentRequirements,
  type Seal,
  agentIdToBytes32,
  buildIntentHash,
  decryptWith,
  eciesPublicKeyOf,
  encryptFor,
  intentToWire,
  parseOrThrow,
  pickBestAgent,
  signIntent,
  createStopwatch,
  type StageMs,
  type DiscoveredAgent,
} from '@ca/shared';
import type { PaymentBackend } from '@ca/payment';
import { Wallet } from 'ethers';

export interface AliceJobOptions {
  /**
   * Bob's base URL. WHEN ABSENT it is discovered from The Graph via `discover`.
   * One of the two is required.
   */
  bobUrl?: string;
  /**
   * Discovery: search by skill and use the endpoint and ECIES pubkey the subgraph reports.
   * Alice not knowing Bob's address is the proof that The Graph is load-bearing.
   */
  discover?: { subgraphUrl: string; skill: string };
  brief: string;
  data: string;
  constraints: Constraints;
  /** Alice's signing wallet (PRIVATE_KEY_ALICE). */
  wallet: Wallet;
  /** Alice's ECIES private key — the result is encrypted to it. */
  eciesPrivateKey: string;
  verifyingContract: string;
  chainId?: number;
  nonce?: bigint;
  /** Unix saniye. Verilmezse +1 saat. */
  deadline?: bigint;
  /**
   * The payment backend. If Bob returns 402, Alice authorises with this.
   * When absent and Bob asks for payment, the job stops with an ERROR — it does not silently continue.
   */
  payment?: { backend: PaymentBackend };
  /** A hook letting tests corrupt the sent payload (fraud/mutation scenarios). */
  tamper?: (envelope: Record<string, unknown>) => Record<string, unknown>;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export interface AliceJobReport {
  /** The record from the subgraph, when discovery was used. */
  discovered?: DiscoveredAgent;
  card: AgentCard;
  intent: Intent;
  signature: string;
  /** The encrypted body that went on the wire — for leak scanning. */
  sentCipher: string;
  postStatus: number;
  result: EchoResult;
  /** Is the commitment Alice signed the same as the one Bob recomputed? */
  matched: boolean;
  /**
   * The body and seal Bob CLAIMS should be taken to the chain.
   *
   * These are what actually go on chain — not the copy the enclave encrypted to Alice.
   * In `forge` mode the two diverge and `sealTampered` becomes true.
   */
  claimedBodyHex: string;
  claimedSeal: Seal;
  /** Did Bob alter the outgoing signature/body? */
  sealTampered: boolean;
  /** P0-G: the stage durations as Alice sees them. */
  stageMs: StageMs;
  /** Did Bob return 402 — i.e. did the payment gate actually engage? */
  paymentRequired: boolean;
}

/** Fetch and validate Bob's discovery card. */
export async function fetchAgentCard(bobUrl: string, fetchImpl: typeof fetch = fetch): Promise<AgentCard> {
  const res = await fetchImpl(`${bobUrl.replace(/\/$/, '')}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`could not fetch the agent card: HTTP ${res.status}`);
  return parseOrThrow(AgentCardSchema, await res.json(), 'AgentCard');
}

/** One end-to-end job: (discovery →) card → intent → encrypted send → encrypted result. */
export async function runAliceJob(options: AliceJobOptions): Promise<AliceJobReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? ((line: string) => console.log(line));
  // P0-G: stage durations. Measured on Alice's side because "end to end" is the time SHE waits.
  const sw = createStopwatch();

  // --- discovery: if we do not know the address, find it via The Graph ---
  let discovered: DiscoveredAgent | undefined;
  let base: string;
  if (options.bobUrl) {
    base = options.bobUrl.replace(/\/$/, '');
  } else if (options.discover) {
    discovered = await pickBestAgent(options.discover.subgraphUrl, options.discover.skill);
    if (!discovered.endpoint) throw new Error(`discovered agent ${discovered.agentId} carries no endpoint`);
    // The registered endpoint is the work endpoint (`.../task`); the base URL is one level up.
    base = discovered.endpoint.replace(/\/task\/?$/, '').replace(/\/$/, '');
    log(
      `[alice] discovered via The Graph: agentId=${discovered.agentId} ` +
        `skills=${discovered.skills.join(',')} verifiedDeliveries=${discovered.verifiedDeliveries}`,
    );
  } else {
    throw new Error('bobUrl ya da discover verilmeli');
  }

  sw.mark('discovery');

  const card = await fetchAgentCard(base, fetchImpl);
  sw.mark('agent_card');
  log(`[alice] agent card received: agentId=${card.agentId} skills=${card.skills.join(',')}`);

  // Silently continuing when discovery and the card disagree would mean encrypting to the
  // wrong recipient. We surface the mismatch as an error.
  if (discovered) {
    if (card.agentId !== discovered.agentId) {
      throw new Error(`discovery agentId ${discovered.agentId} ≠ card agentId ${card.agentId}`);
    }
    if (discovered.eciesPubKey && card.eciesPubKey !== discovered.eciesPubKey) {
      throw new Error('the discovered eciesPubKey differs from the one in the card — which is current is undefined');
    }
  }

  const nonce = options.nonce ?? BigInt(Date.now());
  const price = BigInt(card.price.amount);
  const deadline = options.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);

  const intentHash = buildIntentHash({
    brief: options.brief,
    data: options.data,
    constraints: options.constraints,
    price,
    nonce,
  });

  const intent: Intent = {
    intentHash,
    client: options.wallet.address,
    agentId: agentIdToBytes32(card.agentId),
    price,
    deadline,
  };

  const signature = await signIntent(intent, options.wallet, options.verifyingContract, options.chainId);
  sw.mark('intent_sign');
  log(`[alice] intent signed: ${intentHash.slice(0, 14)}…`);

  let envelope: Record<string, unknown> = {
    v: 1,
    intent: intentToWire(intent),
    aliceSig: signature,
    brief: options.brief,
    data: options.data,
    constraints: options.constraints,
    nonce: nonce.toString(),
    replyPubKey: eciesPublicKeyOf(options.eciesPrivateKey),
  };
  // The tamper HOOK: applied AFTER the signature is made — exactly what an attacker could do.
  // That makes the "one character changed" scenario realistic.
  if (options.tamper) envelope = options.tamper(envelope);

  // When discovery was used, encrypt with the key indexed FROM THE CHAIN: the source is The
  // Graph, not Bob's own claim. (Their equality was already verified above.)
  const encryptTo = discovered?.eciesPubKey ?? card.eciesPubKey;
  const sentCipher = await encryptFor(encryptTo, envelope);
  sw.mark('ecies_encrypt');

  // `intentHash` and `replyPubKey` travel OUTSIDE the ciphertext: Bob's outer layer cannot
  // decrypt the payload (the key is in the enclave) yet must route the job and deliver the
  // result. Nothing leaks — both are already public (on chain and in Alice's 8004 record).
  const taskBody = {
    to: card.agentId,
    intentHash,
    replyPubKey: eciesPublicKeyOf(options.eciesPrivateKey),
    cipher: sentCipher,
  };
  const send = (payment?: unknown) =>
    fetchImpl(`${base}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payment ? { ...taskBody, payment } : taskBody),
    });

  // The x402 flow: try without payment first. If Bob returns 402, authorise and send AGAIN.
  let postRes = await send();
  // This first request can be TWO different things:
  //   payment gate on  → only the 402 round trip (fast)
  //   payment gate off → the ENTIRE job (including the 0G call)
  // So we name it neutrally; `paymentRequired` tells you which it was.
  sw.mark('http_task_send1');
  let paymentAuthorized: PaymentAuthorization | undefined;

  if (postRes.status === 402) {
    if (!options.payment) {
      throw new Error('Bob asked for payment (402) but Alice was given no payment backend');
    }
    const body = (await postRes.json()) as { accepts?: PaymentRequirements[] };
    const requirements = body.accepts?.[0];
    if (!requirements) throw new Error('the 402 response carries no payment requirements');
    log(`[alice] received 402: ${requirements.amount} ${requirements.asset} (${requirements.rail})`);

    // Authorisation — NO MONEY MOVES. Bob holds it and submits it after JobVerified.
    const quote = await options.payment.backend.quote({
      intentHash: requirements.intentHash,
      amount: requirements.amount,
      recipient: requirements.recipient,
    });
    paymentAuthorized = (await options.payment.backend.authorize(quote)) as unknown as PaymentAuthorization;
    log('[alice] payment authorisation signed — the money is still Alice\'s');

    sw.mark('payment_authorize');

    postRes = await send(paymentAuthorized);
    // This stage covers ALL of Bob's work: enclave + 0G call + seal signature.
    // Its internal breakdown is reported separately in `result.stageMs`.
    sw.mark('http_task_send2');
  }

  if (postRes.status !== 202) {
    const body = await postRes.text().catch(() => '');
    throw new Error(`/task did not return 202: HTTP ${postRes.status} ${body}`);
  }
  log(`[alice] payload sent (${(sentCipher.length / 1024).toFixed(1)} KB encrypted)`);

  const resultRes = await fetchImpl(`${base}/result/${intentHash}`);
  sw.mark('http_result');
  if (!resultRes.ok) throw new Error(`could not fetch /result: HTTP ${resultRes.status}`);
  const claimed = (await resultRes.json()) as { cipher: string; bodyHex: string; seal: Seal };

  // The result the enclave ENCRYPTED to Alice — Bob cannot touch it.
  const result = parseOrThrow(
    EchoResultSchema,
    await decryptWith(options.eciesPrivateKey, claimed.cipher),
    'EchoResult',
  );

  // Are the artifacts Bob wants taken to the chain the same as the enclave's?
  // If they differ, Bob altered the outgoing signature/body (`forge` mode).
  const sealTampered =
    claimed.bodyHex !== result.bodyHex ||
    claimed.seal.r !== result.seal.r ||
    claimed.seal.s !== result.seal.s;
  if (sealTampered) {
    log('[alice] WARNING: the body/seal Bob forwarded DIFFERS from what the enclave signed');
  }

  sw.mark('ecies_decrypt_result');

  const matched = result.match && result.recomputedIntentHash === intentHash && !sealTampered;
  log(`[alice] result decrypted: match=${result.match} clientSig=${result.clientSigOk ? 'ok' : 'INVALID'}`);

  return {
    discovered,
    card,
    intent,
    signature,
    sentCipher,
    postStatus: postRes.status,
    result,
    matched,
    claimedBodyHex: claimed.bodyHex,
    claimedSeal: claimed.seal,
    sealTampered,
    paymentRequired: paymentAuthorized !== undefined,
    stageMs: sw.stages(),
  };
}

/** When run directly, it configures itself from .env and runs a single job. */
export async function main(): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const { loadConfig, optionalEnv, requireEnv } = await import('@ca/shared');
  const cfg = loadConfig();

  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const briefArg = arg('brief') ?? 'Analyse the attached report and flag revenue-recognition risks.';
  const dataFile = arg('data');

  const verifyingContract = optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER;
  if (verifyingContract === PLACEHOLDER_VERIFIER) {
    console.warn(
      `[alice] WARNING: VERIFIER_ADDRESS is empty — signing with the placeholder ${PLACEHOLDER_VERIFIER}.\n` +
        `        This signature CANNOT BE VERIFIED by the real Verifier contract (write it to .env once P3-A is deployed).`,
    );
  }

  // DISCOVERY IS THE DEFAULT PATH. `--bob` exists only for local debugging; Alice's
  // Bob'un adresini bilmesi gerekmiyor (BUILD-PLAN P2-C).
  const explicitBob = arg('bob') ?? process.env.BOB_URL;
  const skill = arg('skill') ?? 'market-analysis';

  const report = await runAliceJob({
    bobUrl: explicitBob,
    discover: explicitBob
      ? undefined
      : { subgraphUrl: requireEnv('SUBGRAPH_QUERY_URL', 'pnpm gate:P2-B doldurur'), skill },
    brief: briefArg,
    data: dataFile ? readFileSync(dataFile, 'utf8') : 'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR.',
    constraints: { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 },
    wallet: new Wallet(cfg.PRIVATE_KEY_ALICE),
    eciesPrivateKey: requireEnv('ALICE_ECIES_PRIV', 'generated by pnpm gate:P1-B'),
    verifyingContract,
  });

  console.log('\n--- result ---');
  if (report.discovered) {
    console.log(
      `discovery: The Graph → agentId ${report.discovered.agentId} ` +
        `(verifiedDeliveries ${report.discovered.verifiedDeliveries})`,
    );
  }
  console.log(report.result.output);
  console.log(`match: ${report.matched}`);
}
