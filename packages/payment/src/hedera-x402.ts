// @x402/hedera + blocky402 (agentic run) + HCS timeline.
//
// Minimal PaymentBackend over the Hedera x402 "exact" scheme, settled through the
// real blocky402 testnet facilitator (https://api.testnet.blocky402.com). Proven
// end-to-end (402 -> pay -> 200) in scripts/spikes/hedera-x402-{server,client}.mjs
// (P0(d), see CLAUDE.md §8).
//
// Per CLAUDE.md §11: this buys AUTONOMY on Hedera, not privacy — payer and payTo
// are both plain Hedera account ids, visible on-chain. Stealth/unlinkability is the
// Base-Sepolia backend's job (base-stealth.ts), not this one.
//
// `intentHash` is not (yet) carried inside the x402 payload itself — the exact-Hedera
// scheme has no memo/extra field for it. It is accepted here so the caller can log/
// correlate it with the resulting Hedera transaction id in the HCS timeline; it is
// NOT cryptographically bound into the on-chain transfer by this module.

import { x402ResourceServer } from '@x402/core/server';
import { HTTPFacilitatorClient } from '@x402/core/http';
// Import PrivateKey from @x402/hedera (not @hiero-ledger/sdk directly): @x402/hedera
// pins its own @hiero-ledger/sdk version and re-exports the SDK primitives so callers
// always resolve a single SDK instance (see node_modules/@x402/hedera/README.md).
import { ExactHederaScheme as ExactHederaClientScheme } from '@x402/hedera/exact/client';
import { ExactHederaScheme as ExactHederaServerScheme } from '@x402/hedera/exact/server';
import type { HederaSignerHandle } from './signer/hedera-signer.js';

import type { JsonRpcProvider } from 'ethers';
import {
  assertJobVerified,
  type AuthProof,
  type PaymentBackend,
  type PaymentQuote,
  type QuoteRequest,
  type Receipt,
} from './index.js';

const HEDERA_NETWORK = 'hedera:testnet' as const;
const HBAR_ASSET_ID = '0.0.0';
const MIRROR_NODE_URL = 'https://testnet.mirrornode.hedera.com';
const HASHSCAN = 'https://hashscan.io/testnet';

export interface HederaX402Config {
  /**
   * The DELEGATED signer. The private key DOES NOT ENTER THIS MODULE — signer/hedera-signer.ts
   * reads it from the env itself and keeps it in a closure (BUILD-PLAN P4-C).
   * There is deliberately no way to pass a raw key in here.
   */
  signer: HederaSignerHandle;
  /** blocky402 (or compatible) facilitator base URL, from BLOCKY402_URL. */
  facilitatorUrl: string;
  /**
   * The Base Sepolia provider — used to verify `JobVerified` before settlement.
   * The payment flows on Hedera but the VERDICT is given on Base (clean separation: roadmap v3 §08).
   */
  verifierProvider: JsonRpcProvider;
  verifierAddress: string;
  /**
   * The Hedera account this agent receives payment on.
   *
   * The Bob side uses it to check that an incoming authorisation REALLY pays him — so that
   * an authorisation made out to someone else cannot buy work from him.
   * Not needed on Alice's side.
   */
  payoutAccountId?: string;
}

/**
 * PaymentBackend implementation that pays over Hedera testnet via the x402 `exact`
 * scheme, settling directly against the facilitator (no intermediary HTTP resource
 * server hop — the caller already knows `to`/`amount`, so this module plays both the
 * "resource server" role (build requirements, verify, settle) and the client/payer
 * role in one place).
 */
export function createHederaX402Backend(config: HederaX402Config): PaymentBackend {
  const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });

  // "Resource server" side: builds requirements + calls verify/settle on the real facilitator.
  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(HEDERA_NETWORK, new ExactHederaServerScheme());

  // The "client" side: it signs the transfer — but it never SEES the key, it uses the delegated signer.
  const clientScheme = new ExactHederaClientScheme(config.signer.signer);

  let initialized: Promise<void> | null = null;
  const ensureInitialized = () => {
    if (!initialized) initialized = resourceServer.initialize();
    return initialized;
  };

  /** The as-yet unsubmitted authorisation carried between quote and authorize. */
  interface HederaAuthPayload {
    requirements: unknown;
    paymentPayload: unknown;
  }

  const explorerFor = (txRef: string): string => {
    const [account, stamp] = txRef.split('@');
    if (!account || !stamp) return `${HASHSCAN}/transaction/${txRef}`;
    return `${HASHSCAN}/transaction/${account}-${stamp.replace('.', '-')}`;
  };

  return {
    rail: 'hedera-x402',

    async quote(request: QuoteRequest): Promise<PaymentQuote> {
      await ensureInitialized();
      const [requirements] = await resourceServer.buildPaymentRequirements({
        scheme: 'exact',
        payTo: request.recipient,
        price: { asset: HBAR_ASSET_ID, amount: request.amount },
        network: HEDERA_NETWORK,
        maxTimeoutSeconds: 60,
      });
      if (!requirements) {
        throw new Error(`hedera-x402: the facilitator returned no payment requirements for ${HEDERA_NETWORK}`);
      }
      return {
        rail: 'hedera-x402',
        intentHash: request.intentHash,
        amount: request.amount,
        asset: 'HBAR',
        decimals: 8, // tinybar
        // A plain account id — NO recipient privacy. Deliberate: roadmap v3 §07.
        payTo: request.recipient,
        http402: requirements,
        expiresAt: Date.now() + 60_000,
      };
    },

    async authorize(quote: PaymentQuote): Promise<AuthProof> {
      await ensureInitialized();
      const requirements = quote.http402;
      // A partially signed transfer is built — NO MONEY MOVES. settle() submits it.
      const payloadResult = await clientScheme.createPaymentPayload(2, requirements as never);
      const paymentPayload = {
        x402Version: 2 as const,
        accepted: requirements,
        payload: payloadResult.payload,
      };
      const verifyResult = await resourceServer.verifyPayment(paymentPayload as never, requirements as never);
      if (!verifyResult.isValid) {
        throw new Error(`hedera-x402 verify reddetti: ${verifyResult.invalidReason ?? 'bilinmiyor'}`);
      }
      return {
        rail: 'hedera-x402',
        intentHash: quote.intentHash,
        payTo: quote.payTo,
        amount: quote.amount,
        payload: { requirements, paymentPayload } satisfies HederaAuthPayload,
      };
    },

    async verifyAuthorization(proof, expected) {
      if (proof.rail !== 'hedera-x402') return { ok: false, reason: `wrong rail: ${proof.rail}` };
      if (proof.intentHash.toLowerCase() !== expected.intentHash.toLowerCase()) {
        return { ok: false, reason: 'the authorisation belongs to a different job' };
      }
      if (proof.amount !== expected.amount) {
        return { ok: false, reason: `tutar ${proof.amount}, beklenen ${expected.amount}` };
      }
      // The recipient must be THIS agent — an authorisation paying someone else buys no work here.
      if (proof.payTo !== config.payoutAccountId) {
        return { ok: false, reason: `recipient is ${proof.payTo}, expected ${config.payoutAccountId}` };
      }
      // Let the facilitator verify: is the signature valid, is the balance sufficient. NO MONEY MOVES.
      await ensureInitialized();
      const { requirements, paymentPayload } = proof.payload as HederaAuthPayload;
      const result = await resourceServer.verifyPayment(paymentPayload as never, requirements as never);
      return result.isValid
        ? { ok: true }
        : { ok: false, reason: `facilitator reddetti: ${result.invalidReason ?? 'bilinmiyor'}` };
    },

    async settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt> {
      // THE GATE: if the job was not verified on chain, nothing proceeds past here.
      const verified = await assertJobVerified(
        config.verifierProvider,
        config.verifierAddress,
        jobVerifiedTx,
        proof.intentHash,
      );

      await ensureInitialized();
      const { requirements, paymentPayload } = proof.payload as HederaAuthPayload;
      const settleResult = await resourceServer.settlePayment(paymentPayload as never, requirements as never);
      if (!settleResult.success) {
        throw new Error(`hedera-x402 settle failed: ${settleResult.errorReason ?? 'unknown'}`);
      }

      return {
        rail: 'hedera-x402',
        intentHash: proof.intentHash,
        txRef: settleResult.transaction,
        explorerUrl: explorerFor(settleResult.transaction),
        settledAt: Date.now(),
        jobVerifiedTx,
        jobVerifiedBlock: verified.blockNumber,
        // On this rail the two are the SAME account, deliberately. Bob publishes it in his agent
        // card and is paid on it every time. Reporting both — rather than omitting them because
        // there is nothing to hide — is what lets the two rails be compared honestly.
        paidTo: proof.payTo,
        agentIdentity: proof.payTo,
      };
    },

    async verify(receipt: Receipt): Promise<boolean> {
      // txRef looks like "0.0.7162784@1784936701.955111199". The Mirror Node REST API wants
      // "shard.realm.num-seconds-nanos" — only the '@' and the dot INSIDE THE TIMESTAMP become
      // dashes; the dots in the account id stay.
      const [account, stamp] = receipt.txRef.split('@');
      if (!account || !stamp) return false;
      const mirrorId = `${account}-${stamp.replace('.', '-')}`;
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/transactions/${mirrorId}`);
      if (!res.ok) return false;
      const body = (await res.json()) as { transactions?: Array<{ result?: string }> };
      return body.transactions?.[0]?.result === 'SUCCESS';
    },
  };
}
