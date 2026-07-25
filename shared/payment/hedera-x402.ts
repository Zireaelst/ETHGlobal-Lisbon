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

import type { PaymentBackend } from './index.js';

const HEDERA_NETWORK = 'hedera:testnet' as const;
const HBAR_ASSET_ID = '0.0.0';
const MIRROR_NODE_URL = 'https://testnet.mirrornode.hedera.com';

export interface HederaX402Config {
  /** Payer's Hedera account id, e.g. "0.0.9695366". */
  accountId: string;
  /** Payer's Hedera ECDSA private key (0x-prefixed hex or DER), from HEDERA_PRIVATE_KEY. */
  privateKey: string;
  /** blocky402 (or compatible) facilitator base URL, from X402_FACILITATOR_URL. */
  facilitatorUrl: string;
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

  return {
    async pay({ to, amount, intentHash }) {
      await ensureInitialized();

      const [requirements] = await resourceServer.buildPaymentRequirements({
        scheme: 'exact',
        payTo: to,
        price: { asset: HBAR_ASSET_ID, amount: amount.toString() },
        network: HEDERA_NETWORK,
        maxTimeoutSeconds: 60,
      });

      const feePayer = (requirements.extra as { feePayer?: string } | undefined)?.feePayer ?? 'unknown';
      console.log(
        `[hedera-x402] paying ${amount} tinybars ${config.accountId} -> ${to} ` +
          `(intentHash=${intentHash}, feePayer=${feePayer})`
      );

      const payloadResult = await clientScheme.createPaymentPayload(2, requirements);
      const paymentPayload = {
        x402Version: 2 as const,
        accepted: requirements,
        payload: payloadResult.payload,
      };

      const verifyResult = await resourceServer.verifyPayment(paymentPayload, requirements);
      if (!verifyResult.isValid) {
        throw new Error(`hedera-x402 verify failed: ${verifyResult.invalidReason ?? 'unknown'}`);
      }

      const settleResult = await resourceServer.settlePayment(paymentPayload, requirements);
      if (!settleResult.success) {
        throw new Error(`hedera-x402 settle failed: ${settleResult.errorReason ?? 'unknown'}`);
      }

      console.log(`[hedera-x402] settled: ${settleResult.transaction}`);
      return { txRef: settleResult.transaction };
    },

    async verify(txRef: string): Promise<boolean> {
      // txRef is a Hedera transaction id like "0.0.7162784@1784936701.955111199".
      // Mirror Node REST wants "shard.realm.num-seconds-nanos".
      const mirrorId = txRef.replace('@', '-').replace('.', '-');
      const url = `${MIRROR_NODE_URL}/api/v1/transactions/${mirrorId}`;
      const res = await fetch(url);
      if (!res.ok) return false;
      const body = (await res.json()) as { transactions?: Array<{ result?: string }> };
      return body.transactions?.[0]?.result === 'SUCCESS';
    },
  };
}
