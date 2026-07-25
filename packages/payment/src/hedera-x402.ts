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
import { createClientHederaSigner, PrivateKey } from '@x402/hedera';
import { ExactHederaScheme as ExactHederaClientScheme } from '@x402/hedera/exact/client';
import { ExactHederaScheme as ExactHederaServerScheme } from '@x402/hedera/exact/server';

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
  /** Payer's Hedera account id, e.g. "0.0.9695366". */
  accountId: string;
  /** Payer's Hedera ECDSA private key (0x-prefixed hex or DER), from HEDERA_OPERATOR_KEY. */
  privateKey: string;
  /** blocky402 (or compatible) facilitator base URL, from BLOCKY402_URL. */
  facilitatorUrl: string;
  /**
   * Base Sepolia sağlayıcısı — settlement öncesi `JobVerified`'ı doğrulamak için.
   * Ödeme Hedera'da akıyor ama KARAR Base'de veriliyor (temiz ayrım: roadmap v3 §08).
   */
  verifierProvider: JsonRpcProvider;
  verifierAddress: string;
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

  // "Client" side: signs the actual Hedera transfer transaction with the payer's key.
  const signer = createClientHederaSigner(config.accountId, PrivateKey.fromStringECDSA(config.privateKey), {
    network: HEDERA_NETWORK,
  });
  const clientScheme = new ExactHederaClientScheme(signer);

  let initialized: Promise<void> | null = null;
  const ensureInitialized = () => {
    if (!initialized) initialized = resourceServer.initialize();
    return initialized;
  };

  /** quote → authorize arasında taşınan, henüz gönderilmemiş yetki. */
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
        throw new Error(`hedera-x402: facilitator ${HEDERA_NETWORK} için payment requirements döndürmedi`);
      }
      return {
        rail: 'hedera-x402',
        intentHash: request.intentHash,
        amount: request.amount,
        asset: 'HBAR',
        decimals: 8, // tinybar
        // Düz hesap kimliği — alıcı gizliliği YOK. Bilinçli: roadmap v3 §07.
        payTo: request.recipient,
        http402: requirements,
        expiresAt: Date.now() + 60_000,
      };
    },

    async authorize(quote: PaymentQuote): Promise<AuthProof> {
      await ensureInitialized();
      const requirements = quote.http402;
      // Kısmi imzalı transfer kurulur — PARA HAREKET ETMEZ. Gönderimi settle() yapar.
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

    async settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt> {
      // KAPI: iş zincirde doğrulanmadıysa buradan öteye geçilmez.
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
        throw new Error(`hedera-x402 settle başarısız: ${settleResult.errorReason ?? 'bilinmiyor'}`);
      }

      return {
        rail: 'hedera-x402',
        intentHash: proof.intentHash,
        txRef: settleResult.transaction,
        explorerUrl: explorerFor(settleResult.transaction),
        settledAt: Date.now(),
        jobVerifiedTx,
        jobVerifiedBlock: verified.blockNumber,
      };
    },

    async verify(receipt: Receipt): Promise<boolean> {
      // txRef "0.0.7162784@1784936701.955111199" biçiminde. Mirror Node REST
      // "shard.realm.num-seconds-nanos" istiyor — yalnızca '@' ve TIMESTAMP içindeki
      // nokta tireye döner; hesap kimliğindeki noktalar kalır.
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
