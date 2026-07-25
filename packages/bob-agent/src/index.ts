// bob-agent — Bob's OUTER layer (BUILD-PLAN §2.1).
//
// This process is NOT the enclave, and there are TWO things it cannot do:
//
//   1. IT CANNOT MAKE THE ENCLAVE LIE — the honest recompute and signing live in
//      `@ca/bob-binding`; FRAUD_MODE lives here. Bob can cheat; the enclave cannot lie for him.
//
//   2. IT CANNOT SEE THE CONTENT — the ECIES key is in the enclave too. Only ciphertext ever
//      reaches this layer; the brief, the data and the output never pass through (CLAUDE.md §2).
//
// Fraud is only possible in two places: altering the PAYLOAD going into the enclave (Bob
// encrypts his own payload and swaps it in), or altering the SIGNATURE coming out.
//
// Endpoints:
//   GET  /.well-known/agent-card.json   — the discovery card
//   POST /task                          — { to, intentHash, replyPubKey, cipher }
//   GET  /result/:intentHash            — { cipher, bodyHex, seal }
//        cipher: the result the enclave encrypted to Alice's key (Bob cannot decrypt it)
//        bodyHex/seal: the artifacts Bob CLAIMS should go on chain — Alice can compare the
//        two and spot the tampering
//   POST /settle                        — { intentHash, jobVerifiedTx } (Bob tetikler)
//   POST /admin/fraud-mode              — demo fraud butonu
//   GET  /health

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

import {
  AgentCardSchema,
  PLACEHOLDER_VERIFIER,
  TaskRequestSchema,
  agentIdToBytes32,
  createNoComputeBackend,
  eciesPublicKeyOf,
  parseOrThrow,
  type AgentCard,
  type ComputeBackend,
  type PaymentRequirements,
  type Seal,
} from '@ca/shared';
import { recoverBindingSigner, runBinding, type BindingRequest } from '@ca/bob-binding';
import type { AuthProof, PaymentBackend, Receipt } from '@ca/payment';
import {
  applyPostBindingFraud,
  applyPreBindingFraud,
  isFraudMode,
  type FraudMode,
} from './fraud.js';

export interface BobAgentOptions {
  /** Bob'un ECIES private key'i (BOB_ECIES_PRIV). */
  eciesPrivateKey: string;
  /** ERC-8004 agentId, decimal string. */
  agentId: string;
  /** Bob's wallet address (the registration owner). */
  owner: string;
  skills: string[];
  price: { amount: string; asset: string; decimals: number };
  /** Bob's Hedera payment account — published in the card, used by the payment rail. */
  hederaAccount?: string;
  /** The ERC-5564 stealth meta-address — used by the Base privacy run. */
  stealthMetaAddress?: string;
  /** The EIP-712 domain's verifyingContract — for verifying Alice's signature. */
  verifyingContract: string;
  /**
   * The binding signing key (local in PHASE 1, the enclave seal in P3).
   *
   * This key should live in the enclave, NOT in bob-agent — it is passed through here only
   * because in PHASE 1 the enclave is a function call. In P3-B it moves into the Tapp and
   * bob-agent never sees it again.
   */
  bindingKey: string;
  chainId?: number;
  port?: number;
  /** The initial fraud mode. It can be changed at runtime with `setFraudMode`. */
  fraudMode?: FraudMode;
  /**
   * The first field of the seal preimage — the wrapper's own agent id.
   * It may DIFFER from the ERC-8004 `agentId`; in a real Tapp the wrapper decides it.
   */
  sealAgentId?: string;
  /**
   * Where the model runs. When absent, `none` — NO real inference and NO TEE signature.
   * With 0G tokens available this becomes `createZeroGComputeBackend(...)`; nothing else
   * changes (that is the whole reason the compute.ts boundary exists).
   */
  compute?: ComputeBackend;
  /**
   * The payment gate. WHEN SUPPLIED, Bob DOES NO WORK without a payment authorisation —
   * `/task` returns 402
   * (CLAUDE.md §7: "public HTTP server: 402, forwards work to the Tapp").
   *
   * BOB holds the authorisation and submits it himself via `POST /settle` AFTER `JobVerified`
   * appears. The economic incentive is already his: without verification he does not get paid.
   */
  payment?: {
    backend: PaymentBackend;
    /** The recipient recipe announced in the 402: a meta-address on Base, an account id on Hedera. */
    recipient: string;
    network: string;
  };
  /** The card's `endpoint` field; derived from the listening address when absent. */
  publicUrl?: string;
  log?: (line: string) => void;
  /**
   * Test hook: the plaintext payload Bob DECRYPTED.
   *
   * It exists so a gate test can directly observe whether the plaintext decodes correctly.
   * It adds nothing to the wire and is not used on the production path.
   */
  onDecrypted?: (envelope: { brief: string; data: string; nonce: string }) => void;
}

/**
 * The SUMMARY the outer layer is allowed to keep about a job.
 *
 * Deliberately narrow: every field is going on chain anyway. `brief`, `data` and `output` are
 * NOT HERE — they exist only inside the enclave and in the encrypted result that only Alice
 * can decrypt. Bob's infrastructure cannot see the content of the job.
 */
export interface BobJobSummary {
  intentHash: string;
  recomputedIntentHash: string;
  match: boolean;
  clientSigOk: boolean;
  recoveredClient: string;
  bodyHex: string;
  seal: Seal;
  bindingSigner: string;
  expectedBindingSigner: string;
  bindingSigOk: boolean;
  computeProvider: string;
  ogVerified: boolean;
}

export interface StoredResult {
  /** The result the enclave encrypted to Alice's key. Bob CANNOT decrypt it. */
  cipher: string;
  /**
   * The body and seal Bob CLAIMS should be submitted on chain.
   *
   * They may DIFFER from what the enclave produced — in `forge` mode that is exactly the case.
   * Alice takes these to the chain and, by comparing them with what she decrypted herself, can
   * see the tampering.
   */
  bodyHex: string;
  seal: Seal;
  /** The payment authorisation Alice signed, NOT YET SUBMITTED. Bob holds it. */
  payment?: AuthProof;
  /** The receipt once settled — a repeat settle attempt lands on this. */
  settled?: Receipt;
  receivedAt: number;
}

export interface BobAgent {
  server: Server;
  /** Start listening and return the actual port (when 0 is given the OS picks one). */
  listen(): Promise<number>;
  close(): Promise<void>;
  url(): string;
  card(): AgentCard;
  /** For tests/demo: a plaintext summary of processed jobs (never goes on the wire). */
  readonly processed: BobJobSummary[];
  /** Change the fraud mode AT RUNTIME — NO restart (a BUILD-PLAN P1-D criterion). */
  setFraudMode(mode: FraudMode): void;
  fraudMode(): FraudMode;
  /** The registered signer address of the enclave (in PHASE 1: of the binding function). */
  bindingSigner(): string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** HTTP 402 — the body carries the payment requirements, and NO WORK is done. */
class PaymentRequiredError extends HttpError {
  constructor(readonly requirements: PaymentRequirements) {
    super(402, 'payment authorisation required');
  }
}

function readBody(req: IncomingMessage, limitBytes = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new HttpError(413, `body exceeded the ${limitBytes} byte limit`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createBobAgent(options: BobAgentOptions): BobAgent {
  const log = options.log ?? ((line: string) => console.log(line));
  const eciesPubKey = eciesPublicKeyOf(options.eciesPrivateKey);
  const results = new Map<string, StoredResult>();
  const processed: BobJobSummary[] = [];
  let boundPort = options.port ?? 0;
  // The fraud mode is MUTABLE: restarting during the demo would lose the seal key (v3 §06),
  // so the mode has to be changeable while running.
  let fraudMode: FraudMode = options.fraudMode ?? 'none';
  const expectedBindingSigner = new Wallet(options.bindingKey).address;
  // The seal id is generated once per container lifetime (in a real Tapp the wrapper generates
  // it). Keeping it constant for the process is the local counterpart of P3-C's "do not restart"
  // rule.
  const sealId = keccak256(toUtf8Bytes(`seal/${expectedBindingSigner}/${options.agentId}`)).slice(0, 18);
  const computeBackend = options.compute ?? createNoComputeBackend();

  /** Bob's 402 body: the price + the recipient RECIPE (not an address — a meta-address on Base). */
  const paymentRequirementsFor = (intentHash: string): PaymentRequirements => {
    const p = options.payment;
    if (!p) throw new Error('the payment gate is not configured');
    return {
      rail: p.backend.rail,
      intentHash,
      amount: options.price.amount,
      asset: options.price.asset,
      decimals: options.price.decimals,
      recipient: p.recipient,
      network: p.network,
      expiresAt: Date.now() + 300_000,
    };
  };

  const url = () => options.publicUrl ?? `http://127.0.0.1:${boundPort}`;

  const card = (): AgentCard =>
    parseOrThrow(
      AgentCardSchema,
      {
        v: 1,
        name: 'Bob',
        agentId: options.agentId,
        owner: options.owner,
        skills: options.skills,
        endpoint: `${url()}/task`,
        eciesPubKey,
        price: options.price,
        stealthMetaAddress: options.stealthMetaAddress ?? null,
        hederaAccount: options.hederaAccount ?? null,
      },
      'AgentCard',
    );

  /** The PHASE 1 workflow: decrypt → recompute → match → store the encrypted result. */
  async function handleTask(rawBody: string): Promise<{ intentHash: string }> {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, 'body is not valid JSON');
    }

    let request;
    try {
      request = parseOrThrow(TaskRequestSchema, json, 'TaskRequest');
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }

    if (request.to !== options.agentId) {
      throw new HttpError(404, `this agent is ${options.agentId}, the payload was addressed to ${request.to}`);
    }

    // --- THE PAYMENT GATE: no authorisation → 402, and NO work ---
    let acceptedPayment: AuthProof | undefined;
    if (options.payment) {
      if (!request.payment) {
        throw new PaymentRequiredError(paymentRequirementsFor(request.intentHash));
      }
      const proof = request.payment as unknown as AuthProof;
      const check = await options.payment.backend.verifyAuthorization(proof, {
        amount: options.price.amount,
        intentHash: request.intentHash,
      });
      if (!check.ok) {
        throw new HttpError(402, `payment authorisation rejected: ${check.reason ?? 'unknown'}`);
      }
      acceptedPayment = proof;
      log(`[bob] payment authorisation accepted (${proof.rail}) — the money has NOT moved YET`);
    }

    // NO DECRYPTION HERE. The key is in the enclave; only ciphertext reaches the outer layer.
    // That is the only way the claim "the infrastructure cannot see the data" holds (CLAUDE.md §2).
    const mode = fraudMode;

    // --- the fraud layer: BEFORE it ENTERS the enclave ---
    // Because Bob cannot decrypt the payload he cannot "edit" the brief; the only thing he can
    // do is encrypt HIS OWN payload to the enclave's pubkey and swap it in.
    let request2: BindingRequest = {
      cipher: request.cipher,
      agentId: options.sealAgentId ?? `agent-${options.agentId}`,
      sealId,
      timestamp: Math.floor(Date.now() / 1000).toString(),
      verifyingContract: options.verifyingContract,
      chainId: options.chainId,
    };
    request2 = await applyPreBindingFraud(mode, request2, {
      intentHash: request.intentHash,
      replyPubKey: request.replyPubKey,
      enclavePublicKey: eciesPubKey,
      agentIdBytes32: agentIdToBytes32(options.agentId),
    });

    // --- the HONEST binding (the enclave) — FRAUD_MODE DOES NOT ENTER HERE ---
    // Decryption, schema validation, recompute, signature verification and result encryption ALL
    // happen inside.
    let bound;
    try {
      bound = await runBinding(request2, { ecies: options.eciesPrivateKey, binding: options.bindingKey }, {
        compute: computeBackend,
        onDecrypted: options.onDecrypted,
      });
    } catch (err) {
      // A payload that cannot be decrypted or fails the schema is not a SERVER error — 400.
      throw new HttpError(400, `payload could not be processed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // --- the fraud layer: AFTER it RETURNS from the enclave ---
    const finalBinding = applyPostBindingFraud(mode, bound);

    // Because `v` is discarded, we pass the expected signer so the right parity is chosen.
    const bindingSigner = recoverBindingSigner(finalBinding.bodyHex, finalBinding.seal, expectedBindingSigner);
    const bindingSigOk = bindingSigner.toLowerCase() === expectedBindingSigner.toLowerCase();

    // The summary the outer layer keeps: every field is going on chain anyway.
    // `output` is NOT HERE — it exists only in the encrypted result Alice can decrypt.
    processed.push({
      intentHash: finalBinding.claimedIntentHash,
      recomputedIntentHash: finalBinding.recomputedIntentHash,
      match: finalBinding.match,
      clientSigOk: finalBinding.clientSigOk,
      recoveredClient: finalBinding.recoveredClient,
      bodyHex: finalBinding.bodyHex,
      seal: finalBinding.seal,
      bindingSigner,
      expectedBindingSigner,
      bindingSigOk,
      computeProvider: finalBinding.computeProvider,
      ogVerified: finalBinding.ogVerified,
    });

    // The result is stored under the commitment Alice declared on the wire — so that even if
    // Bob answered a different job, Alice can still ask for it by her own intentHash.
    // The ENCLAVE did the encryption; the outer layer merely carries it.
    results.set(request.intentHash, {
      cipher: finalBinding.resultCipher,
      // When fraud was applied, what sits here is Bob's ALTERED version.
      bodyHex: finalBinding.bodyHex,
      seal: finalBinding.seal,
      // The authorisation stays with BOB; once JobVerified appears it is submitted via `POST /settle`.
      payment: acceptedPayment,
      receivedAt: Date.now(),
    });

    log(
      `[bob] /task intentHash=${request.intentHash.slice(0, 12)}… mode=${mode} ` +
        `match=${finalBinding.match} clientSig=${finalBinding.clientSigOk ? 'ok' : 'HATALI'} ` +
        `bindingSig=${bindingSigOk ? 'ok' : 'HATALI'}`,
    );
    return { intentHash: request.intentHash };
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const path = (req.url ?? '').split('?')[0] ?? '';

        if (req.method === 'GET' && path === '/health') {
          sendJson(res, 200, { status: 'healthy', agentId: options.agentId, stage: 'echo' });
          return;
        }
        if (req.method === 'GET' && path === '/.well-known/agent-card.json') {
          sendJson(res, 200, card());
          return;
        }
        if (req.method === 'POST' && path === '/task') {
          const accepted = await handleTask(await readBody(req));
          // The response carries only the commitment — `match` lives INSIDE the encrypted result,
          // so an observer cannot read the outcome of the job in the clear.
          sendJson(res, 202, { accepted: true, intentHash: accepted.intentHash });
          return;
        }
        // Demo dApp'in fraud butonu buraya vuracak (P5-A). Restart YOK.
        if (req.method === 'POST' && path === '/admin/fraud-mode') {
          const body = await readBody(req);
          let requested: unknown;
          try {
            requested = (JSON.parse(body) as { mode?: unknown }).mode;
          } catch {
            throw new HttpError(400, 'body is not valid JSON');
          }
          if (!isFraudMode(requested)) {
            throw new HttpError(400, `bilinmeyen mod: ${String(requested)}`);
          }
          const previous = fraudMode;
          fraudMode = requested;
          log(`[bob] FRAUD_MODE ${previous} -> ${fraudMode} (restart yok)`);
          sendJson(res, 200, { previous, mode: fraudMode });
          return;
        }
        if (req.method === 'GET' && path === '/admin/fraud-mode') {
          sendJson(res, 200, { mode: fraudMode });
          return;
        }
        // BOB triggers settlement — the economic incentive is his. The gate is `assertJobVerified`:
        // no money is released for an unverified job (payment/guard.ts).
        if (req.method === 'POST' && path === '/settle') {
          if (!options.payment) throw new HttpError(400, 'the payment gate is not configured');
          const body = await readBody(req);
          let parsed: { intentHash?: string; jobVerifiedTx?: string };
          try {
            parsed = JSON.parse(body) as typeof parsed;
          } catch {
            throw new HttpError(400, 'body is not valid JSON');
          }
          if (!parsed.intentHash || !parsed.jobVerifiedTx) {
            throw new HttpError(400, 'intentHash ve jobVerifiedTx zorunlu');
          }
          const stored = results.get(parsed.intentHash);
          if (!stored) throw new HttpError(404, 'no job for this intentHash');
          if (!stored.payment) throw new HttpError(400, 'no stored payment authorisation for this job');
          if (stored.settled) {
            sendJson(res, 200, { alreadySettled: true, receipt: stored.settled });
            return;
          }
          try {
            const receipt = await options.payment.backend.settle(stored.payment, parsed.jobVerifiedTx);
            stored.settled = receipt;
            log(`[bob] settle edildi: ${receipt.explorerUrl}`);
            sendJson(res, 200, { receipt });
          } catch (err) {
            // An unverified job → SettlementNotAuthorizedError. This is not a failure but the
            // system behaving correctly: "the payment never settled".
            throw new HttpError(402, err instanceof Error ? err.message : String(err));
          }
          return;
        }
        if (req.method === 'GET' && path.startsWith('/result/')) {
          const stored = results.get(path.slice('/result/'.length));
          if (!stored) {
            sendJson(res, 404, { error: 'NOT_FOUND', message: 'no result for this intentHash' });
            return;
          }
          sendJson(res, 200, { cipher: stored.cipher, bodyHex: stored.bodyHex, seal: stored.seal });
          return;
        }
        sendJson(res, 404, { error: 'NOT_FOUND' });
      } catch (err) {
        // 402: the body carries the payment requirements — the client reads them and authorises.
        if (err instanceof PaymentRequiredError) {
          sendJson(res, 402, { error: 'PAYMENT_REQUIRED', accepts: [err.requirements] });
          return;
        }
        if (err instanceof HttpError) {
          sendJson(res, err.status, { error: 'BAD_REQUEST', message: err.message });
          return;
        }
        log(`[bob] UNEXPECTED ERROR: ${err instanceof Error ? err.stack : String(err)}`);
        sendJson(res, 500, { error: 'INTERNAL_ERROR' });
      }
    })();
  });

  return {
    server,
    processed,
    card,
    url,
    setFraudMode: (mode: FraudMode) => {
      log(`[bob] FRAUD_MODE ${fraudMode} -> ${mode} (restart yok)`);
      fraudMode = mode;
    },
    fraudMode: () => fraudMode,
    bindingSigner: () => expectedBindingSigner,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(options.port ?? 0, '127.0.0.1', () => {
          boundPort = (server.address() as AddressInfo).port;
          log(`[bob] agentId=${options.agentId} dinliyor: ${url()}`);
          resolve(boundPort);
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** When run directly, it configures itself from .env and starts up. */
export async function main(): Promise<void> {
  const { loadConfig, optionalEnv, requireEnv } = await import('@ca/shared');
  const cfg = loadConfig();
  const verifyingContract = optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER;
  if (verifyingContract === PLACEHOLDER_VERIFIER) {
    console.warn(
      `[bob] WARNING: VERIFIER_ADDRESS is empty — using the placeholder ${PLACEHOLDER_VERIFIER} in the EIP-712 domain.\n` +
        `      Once P3-A is deployed it must be written to .env, otherwise signatures cannot be verified by the contract.`,
    );
  }
  const agent = createBobAgent({
    eciesPrivateKey: requireEnv('BOB_ECIES_PRIV', 'generated by pnpm gate:P1-B'),
    agentId: requireEnv('BOB_AGENT_ID', 'pnpm gate:P0-F doldurur'),
    owner: new Wallet(cfg.PRIVATE_KEY_BOB).address,
    skills: ['market-analysis'],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract,
    // PHASE 1: the binding key is DERIVED from Bob's wallet. In P3-C it is replaced by the seal
    // key the enclave generates, registered on chain with `setEnclaveSigner`.
    bindingKey: keccak256(toUtf8Bytes(`phase1-binding-key/${cfg.PRIVATE_KEY_BOB}`)),
    fraudMode: isFraudMode(cfg.FRAUD_MODE) ? cfg.FRAUD_MODE : 'none',
    port: Number(process.env.BOB_PORT ?? 8801),
  });
  await agent.listen();
}
