// okx-x402.ts — the THIRD payment rail: x402 `exact` on X Layer testnet, settled by OKX.
//
// The sibling of `hedera-x402.ts`, deliberately: same shape, same three phases, same gate. It
// exists to prove that `PaymentBackend` really is swappable — an interface that has carried
// only two implementations has been asserted, not demonstrated.
//
// WHAT THIS RAIL BUYS, honestly (CLAUDE.md §11 discipline):
//   - It is a REAL OKX settlement. OKX's own facilitator verifies and settles it.
//   - It is 100% TESTNET. X Layer testnet, `eip155:1952`, faucet OKB for gas.
//   - It buys NO privacy. `payTo` is a plain EVM address, visible on chain, exactly like the
//     Hedera rail and unlike the Base stealth rail. Recipient unlinkability is base-stealth's
//     job and is not claimed here.
//
// ── THE INTENT HASH IS *NOT* CRYPTOGRAPHICALLY BOUND BY THIS RAIL ──────────────────────────
//
// `extra.intentHash` below travels in the payment requirements. It is NOT covered by the
// payer's signature: the `exact` scheme signs an EIP-3009 authorisation over
// `(from, to, value, validAfter, validBefore, nonce)` and nothing else. An intermediary could
// rewrite `extra.intentHash` and the signature would still verify.
//
// So the field is for OBSERVABILITY AND DEBUGGING — correlating a settlement with a job in
// logs and in the dashboard. It is not evidence.
//
//   SAY:     "the intentHash travels with the payment request; the binding is in the enclave
//             and in the contract, not in the payment signature."
//   DO NOT SAY: "the intentHash is embedded in the payload and protected by the signature."
//               "the payment is cryptographically bound to the job."   ← false on this rail
//
// The rail that CAN bind it is EIP-3009's own `nonce`, which is a free bytes32 the payer
// chooses: setting it to a commitment over the intent puts the job inside the signed struct.
// That is a separate change to `base-stealth.ts` and is not done here.
// ───────────────────────────────────────────────────────────────────────────────────────────
//
// THE GATE IS UNCHANGED AND NON-NEGOTIABLE: `settle()` begins with `assertJobVerified`, which
// reads Base Sepolia and confirms the transaction really emitted `JobVerified` for this
// `intentHash`. The verdict stays on Base no matter which rail moved the money.

import { x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme as ExactEvmClientScheme } from '@x402/evm/exact/client';
import { ExactEvmScheme as ExactEvmServerScheme } from '@x402/evm/exact/server';
import { Wallet, type JsonRpcProvider } from 'ethers';

import {
  assertJobVerified,
  type AuthProof,
  type PaymentBackend,
  type PaymentQuote,
  type QuoteRequest,
  type Receipt,
} from './index.js';
import { OkxFacilitatorClient } from './okx-facilitator.js';

/** X Layer testnet. CAIP-2; the numeric chain id is 1952 (195 is the retired testnet). */
export const XLAYER_TESTNET = 'eip155:1952' as const;
export const XLAYER_CHAIN_ID = 1952;

const OKLINK = 'https://www.oklink.com/xlayer-test';
const DEFAULT_XLAYER_RPC = 'https://testrpc.xlayer.tech/terigon';

/**
 * A settlement asset on X Layer, with the EIP-712 domain its payer signs under.
 *
 * EVERY FIELD BELOW WAS READ OFF THE CHAIN, not copied from a document, and the reason is
 * concrete: OKX's own testnet mock merchant advertises the WRONG domain version for
 * `USDC_TEST`. Verified 2026-08-20 against `https://testrpc.xlayer.tech/terigon`
 * (`scripts/spikes/xlayer-verify.mjs` reproduces all of it):
 *
 *   mock merchant  →  extra: { name: "USDC_TEST", version: "1" }
 *   the contract   →  version() = "2"
 *                     DOMAIN_SEPARATOR() = 0x7513e76c…baef959
 *
 * and that separator is reproduced ONLY by version "2"
 * (name="USDC_TEST", chainId=1952, verifyingContract=<the token>). A payer signing under "1"
 * builds a different digest and `transferWithAuthorization` rejects it. The contract is what
 * verifies the signature, so the contract is what we believe.
 */
export interface XLayerAsset {
  address: string;
  decimals: number;
  symbol: string;
  /** EIP-712 domain `name`, from the contract's own `name()`. */
  eip712Name: string;
  /** EIP-712 domain `version` — reproduced from `DOMAIN_SEPARATOR()`, not from a doc. */
  eip712Version: string;
}

/** OKX's testnet mock-merchant asset, and what an OKX demo wallet actually holds. Default. */
export const XLAYER_USDC_TEST: XLayerAsset = {
  address: '0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d',
  decimals: 6,
  symbol: 'USDC_TEST',
  eip712Name: 'USDC_TEST',
  eip712Version: '2',
};

/** USD₮0 — the default asset OKX's Go SDK declares for `eip155:1952`. `version()` has no getter; "1" was derived from `DOMAIN_SEPARATOR()`. */
export const XLAYER_USDT0: XLayerAsset = {
  address: '0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c',
  decimals: 6,
  symbol: 'USDT0',
  eip712Name: 'USD₮0',
  eip712Version: '1',
};

/** Circle-issued native USDC on X Layer testnet. Real, and distinct from `USDC_TEST`. */
export const XLAYER_USDC_NATIVE: XLayerAsset = {
  address: '0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3',
  decimals: 6,
  symbol: 'USDC',
  eip712Name: 'USDC',
  eip712Version: '2',
};

const ASSETS: Record<string, XLayerAsset> = {
  usdc_test: XLAYER_USDC_TEST,
  usdt0: XLAYER_USDT0,
  usdc: XLAYER_USDC_NATIVE,
};

/**
 * Pick the settlement asset. `OKX_XLAYER_ASSET` selects; `OKX_XLAYER_EIP712_VERSION`
 * overrides just the domain version.
 *
 * The override exists so a disagreement with OKX's facilitator can be settled by
 * configuration rather than by editing a constant — which would erase the on-chain-verified
 * value from the record.
 */
export function xlayerAsset(env: NodeJS.ProcessEnv = process.env): XLayerAsset {
  const base = ASSETS[(env.OKX_XLAYER_ASSET ?? '').trim().toLowerCase()] ?? XLAYER_USDC_TEST;
  const override = env.OKX_XLAYER_EIP712_VERSION?.trim();
  return override ? { ...base, eip712Version: override } : base;
}

export interface OkxX402Config {
  /** Alice's key — SIGNS the EIP-3009 authorisation. No gas: the facilitator submits. */
  payerPrivateKey: string;
  /** OKX's facilitator. Absent → this rail cannot be used; the caller must not offer it. */
  facilitator: OkxFacilitatorClient;
  /**
   * The Base Sepolia provider — used to verify `JobVerified` BEFORE settlement.
   * The money moves on X Layer; the VERDICT is given on Base. Clean separation, unchanged.
   */
  verifierProvider: JsonRpcProvider;
  verifierAddress: string;
  /** The asset to quote in. Defaults to the on-chain-verified `USDC_TEST`. */
  asset?: XLayerAsset;
  /**
   * The EVM address this agent receives payment on.
   * The Bob side uses it to check an incoming authorisation really pays HIM.
   */
  payoutAddress?: string;
  log?: (line: string) => void;
}

/** The as-yet unsubmitted authorisation carried between quote and authorize. */
interface OkxAuthPayload {
  requirements: unknown;
  paymentPayload: unknown;
}

/**
 * Adapt an ethers `Wallet` to x402's `ClientEvmSigner`.
 *
 * x402/evm expects a viem-shaped signer — `signTypedData({domain, types, primaryType,
 * message})` as ONE object — while ethers takes three positional arguments and derives the
 * primary type itself. Fifteen lines here keep viem out of the payment path entirely; the
 * rest of this repo signs with ethers and a second signing stack is a second place for a
 * key to live.
 *
 * `EIP712Domain` is stripped because ethers rejects it as a member of `types` (it infers the
 * domain type from the domain object), whereas viem tolerates it.
 */
function ethersClientSigner(wallet: Wallet) {
  return {
    address: wallet.address as `0x${string}`,
    async signTypedData(message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> {
      const { EIP712Domain: _ignored, ...types } = message.types as Record<string, unknown>;
      return (await wallet.signTypedData(
        message.domain as never,
        types as never,
        message.message as never,
      )) as `0x${string}`;
    },
  };
}

/**
 * A `PaymentBackend` that pays over X Layer testnet via the x402 `exact` scheme, settled by
 * OKX's facilitator.
 *
 * Like `hedera-x402.ts`, this module plays BOTH roles — the "resource server" (build
 * requirements, verify, settle) and the client/payer — because the caller already knows `to`
 * and `amount`, so an intermediary HTTP hop would add nothing but a failure mode.
 */
export function createOkxX402Backend(config: OkxX402Config): PaymentBackend {
  const log = config.log ?? (() => {});
  const asset = config.asset ?? xlayerAsset();

  const resourceServer = new x402ResourceServer([config.facilitator]);
  resourceServer.register(XLAYER_TESTNET, new ExactEvmServerScheme());

  const wallet = new Wallet(config.payerPrivateKey);
  const clientScheme = new ExactEvmClientScheme(ethersClientSigner(wallet));

  let initialized: Promise<void> | null = null;
  const ensureInitialized = () => {
    if (!initialized) initialized = resourceServer.initialize();
    return initialized;
  };

  return {
    rail: 'okx-x402',

    async quote(request: QuoteRequest): Promise<PaymentQuote> {
      await ensureInitialized();
      const [requirements] = await resourceServer.buildPaymentRequirements({
        scheme: 'exact',
        payTo: request.recipient,
        price: { asset: asset.address, amount: request.amount },
        network: XLAYER_TESTNET,
        maxTimeoutSeconds: 180,
        // The EIP-712 domain the payer signs under — stated, never left to a default, because
        // it decides whether the signature verifies at all (see XLayerAsset above).
        //
        // `intentHash` rides along for OBSERVABILITY ONLY. It is not signed. See the header.
        extra: {
          name: asset.eip712Name,
          version: asset.eip712Version,
          intentHash: request.intentHash,
        },
      });
      if (!requirements) {
        throw new Error(`okx-x402: the facilitator returned no payment requirements for ${XLAYER_TESTNET}`);
      }

      return {
        rail: 'okx-x402',
        intentHash: request.intentHash,
        amount: request.amount,
        asset: asset.symbol,
        decimals: asset.decimals,
        // A plain EVM address — NO recipient privacy, and that is deliberate and stated.
        payTo: request.recipient,
        http402: requirements,
        expiresAt: Date.now() + 180_000,
      };
    },

    async authorize(quote: PaymentQuote): Promise<AuthProof> {
      await ensureInitialized();
      const requirements = quote.http402;
      // An EIP-3009 authorisation is signed — NO MONEY MOVES. `settle()` submits it.
      const payloadResult = await clientScheme.createPaymentPayload(2, requirements as never);
      const paymentPayload = {
        x402Version: 2 as const,
        accepted: requirements,
        payload: payloadResult.payload,
      };
      const verifyResult = await resourceServer.verifyPayment(paymentPayload as never, requirements as never);
      if (!verifyResult.isValid) {
        throw new Error(`okx-x402 verify rejected: ${verifyResult.invalidReason ?? 'unknown'}`);
      }
      log('[okx-x402] EIP-3009 authorisation signed — the money has NOT moved YET');

      return {
        rail: 'okx-x402',
        intentHash: quote.intentHash,
        payTo: quote.payTo,
        amount: quote.amount,
        payload: { requirements, paymentPayload } satisfies OkxAuthPayload,
      };
    },

    async verifyAuthorization(proof, expected) {
      if (proof.rail !== 'okx-x402') return { ok: false, reason: `wrong rail: ${proof.rail}` };
      if (proof.intentHash.toLowerCase() !== expected.intentHash.toLowerCase()) {
        return { ok: false, reason: 'the authorisation belongs to a different job' };
      }
      if (proof.amount !== expected.amount) {
        return { ok: false, reason: `amount is ${proof.amount}, expected ${expected.amount}` };
      }
      // The recipient must be THIS agent — an authorisation paying someone else buys no work.
      if (config.payoutAddress && proof.payTo.toLowerCase() !== config.payoutAddress.toLowerCase()) {
        return { ok: false, reason: `recipient is ${proof.payTo}, expected ${config.payoutAddress}` };
      }
      // Let OKX verify the signature. NO MONEY MOVES.
      await ensureInitialized();
      const { requirements, paymentPayload } = proof.payload as OkxAuthPayload;
      const result = await resourceServer.verifyPayment(paymentPayload as never, requirements as never);
      if (!result.isValid) {
        return { ok: false, reason: `OKX facilitator rejected: ${result.invalidReason ?? 'unknown'}` };
      }

      // IS THE PAYER ACTUALLY GOOD FOR IT? We check this OURSELVES because OKX's /verify does
      // not: measured 2026-08-20 against a payer holding 0 USDC_TEST, the facilitator returned
      // isValid — and settlement would then fail AFTER Bob had already done the work and given
      // away the deliverable. `base-stealth.ts` has always made this check; relying on a
      // facilitator to make it for us turned out to be relying on something that isn't there.
      const payer = (paymentPayload as { payload?: { authorization?: { from?: string } } })?.payload
        ?.authorization?.from;
      if (payer) {
        try {
          const rpc = process.env.XLAYER_RPC_URL?.trim() || DEFAULT_XLAYER_RPC;
          const res = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'eth_call',
              params: [
                { to: asset.address, data: `0x70a08231${payer.slice(2).toLowerCase().padStart(64, '0')}` },
                'latest',
              ],
            }),
            signal: AbortSignal.timeout(20_000),
          });
          const body = (await res.json()) as { result?: string };
          if (body.result && body.result !== '0x') {
            const balance = BigInt(body.result);
            if (balance < BigInt(expected.amount)) {
              return {
                ok: false,
                reason: `payer's ${asset.symbol} balance is insufficient (${balance} < ${expected.amount})`,
              };
            }
          }
        } catch {
          // A balance read that cannot complete is not evidence of insolvency. The signature
          // checks above already passed; refusing the job over an RPC hiccup would be a worse
          // failure than the one this guard exists to prevent.
        }
      }

      return { ok: true };
    },

    async settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt> {
      // THE GATE. Identical to the other two rails, and first on purpose: if the job was not
      // verified on Base, nothing below this line runs. On a fraud run settle() is never even
      // reached — but if it were, this is what stops it.
      const verified = await assertJobVerified(
        config.verifierProvider,
        config.verifierAddress,
        jobVerifiedTx,
        proof.intentHash,
      );

      await ensureInitialized();
      const { requirements, paymentPayload } = proof.payload as OkxAuthPayload;
      const settleResult = await resourceServer.settlePayment(paymentPayload as never, requirements as never);
      if (!settleResult.success) {
        throw new Error(`okx-x402 settle failed: ${settleResult.errorReason ?? 'unknown'}`);
      }
      log(`[okx-x402] settled on X Layer testnet: ${settleResult.transaction}`);

      return {
        rail: 'okx-x402',
        intentHash: proof.intentHash,
        txRef: settleResult.transaction,
        explorerUrl: `${OKLINK}/tx/${settleResult.transaction}`,
        settledAt: Date.now(),
        jobVerifiedTx,
        jobVerifiedBlock: verified.blockNumber,
        // Same account, reported rather than hidden: on this rail the payout names the agent,
        // exactly as on Hedera. Only base-stealth breaks that link, and only it may claim to.
        paidTo: proof.payTo,
        agentIdentity: proof.payTo,
      };
    },

    async verify(receipt: Receipt): Promise<boolean> {
      // Read X Layer directly rather than trusting the settle response we already hold.
      const rpc = process.env.XLAYER_RPC_URL?.trim() || 'https://testrpc.xlayer.tech/terigon';
      try {
        const res = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionReceipt',
            params: [receipt.txRef],
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { result?: { status?: string } | null };
        return body.result?.status === '0x1';
      } catch {
        return false;
      }
    },
  };
}

export { OKLINK };
