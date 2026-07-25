// base-stealth.ts — x402 + ERC-5564 stealth on Base Sepolia (the PRIVACY run).
//
// This is the rail that hides the recipient's identity. Bob publishes a meta-address; for
// every job Alice derives a FRESH stealth address and pays that. On chain you see "an
// address received USDC"; its link to Bob's ERC-8004 identity is INVISIBLE.
//
// The difference from the Hedera rail is deliberate (roadmap v3 §07): stealth recipient
// privacy is an EVM construction and does not fit Hedera's account model. We present two
// separate proofs.
//
// GAS: Alice PAYS NO gas. She signs the authorisation with EIP-3009
// `transferWithAuthorization` and a relayer submits the transaction. On Hedera that role is
// played by the real blocky402 facilitator; on Base it is our own relayer wallet — the
// README says so plainly.
//
// THE STEALTH ADDRESS HAS NO ETH, AND MUST NOT: sending ETH to it links it to the sender
// and breaks the privacy. Bob also withdraws via EIP-3009 — the stealth key signs the
// authorisation and the relayer again pays the gas. So the address never sees any ETH.

import { Contract, Wallet, hexlify, randomBytes, verifyTypedData, type JsonRpcProvider } from 'ethers';
import {
  assertJobVerified,
  type AuthProof,
  type PaymentBackend,
  type PaymentQuote,
  type QuoteRequest,
  type Receipt,
} from './index.js';
import { SCHEME_ID, checkAnnouncement, deriveStealthPayment, type StealthPayment } from './stealth.js';

const BASESCAN = 'https://sepolia.basescan.org';

/** The canonical ERC-5564 singletons — both are live on Base Sepolia. */
export const ERC5564_ANNOUNCER = '0x55649E01B5Df198D18D95b5cc5051630cfD45564';
export const ERC6538_REGISTRY = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538';

export const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)',
  'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
];

export const REGISTRY_ABI = [
  'function registerKeys(uint256 schemeId, bytes stealthMetaAddress)',
  'function stealthMetaAddressOf(address registrant, uint256 schemeId) view returns (bytes)',
];

export const USDC_ABI = [
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
];

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export interface BaseStealthConfig {
  provider: JsonRpcProvider;
  /** Alice — SIGNS the authorisation, pays no gas. */
  payerPrivateKey: string;
  /**
   * Submits the transaction and pays the gas. On Hedera blocky402 plays this role;
   * on Base it is our own wallet — named "relayer" honestly.
   */
  relayerPrivateKey: string;
  usdcAddress: string;
  verifierAddress: string;
  /** Bob'un ERC-5564 meta-adresi (agent card / registry'den). */
  recipientMetaAddress?: string;
  announcerAddress?: string;
  /**
   * The BOB side: used to verify that an incoming payment is really his.
   * The viewing key grants NO spending authority — it only answers 'is this mine?'.
   * Not needed on Alice's side.
   */
  viewingPrivateKey?: string;
  spendingPublicKey?: string;
  log?: (line: string) => void;
}

/** The as-yet UNSUBMITTED authorisation carried between quote and authorize. */
interface StealthAuthPayload {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
  ephemeralPublicKey: string;
  viewTag: number;
  metadata: string;
}

/** Sign an EIP-3009 authorisation — NO money MOVES, only a permission is produced. */
export async function signTransferAuthorization(params: {
  provider: JsonRpcProvider;
  usdcAddress: string;
  signerPrivateKey: string;
  to: string;
  value: bigint;
  validSeconds?: number;
}): Promise<StealthAuthPayload> {
  const usdc = new Contract(params.usdcAddress, USDC_ABI, params.provider);
  const [name, version, network] = await Promise.all([
    usdc.getFunction('name')() as Promise<string>,
    usdc.getFunction('version')() as Promise<string>,
    params.provider.getNetwork(),
  ]);

  const wallet = new Wallet(params.signerPrivateKey);
  const now = Math.floor(Date.now() / 1000);
  const message = {
    from: wallet.address,
    to: params.to,
    value: params.value,
    validAfter: 0n,
    validBefore: BigInt(now + (params.validSeconds ?? 3600)),
    nonce: hexlify(randomBytes(32)),
  };

  const signature = await wallet.signTypedData(
    { name, version, chainId: network.chainId, verifyingContract: params.usdcAddress },
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    message,
  );

  return {
    from: message.from,
    to: message.to,
    value: message.value.toString(),
    validAfter: message.validAfter.toString(),
    validBefore: message.validBefore.toString(),
    nonce: message.nonce,
    signature,
    ephemeralPublicKey: '',
    viewTag: 0,
    metadata: '0x',
  };
}

/**
 * Recover the signer of an EIP-3009 authorisation — Bob's "does this signature really
 * belong to the payer?" check. The digest is rebuilt from the struct's OWN fields; the
 * claim is not trusted.
 */
export async function recoverTransferAuthorizationSigner(
  provider: JsonRpcProvider,
  usdcAddress: string,
  auth: Pick<StealthAuthPayload, 'from' | 'to' | 'value' | 'validAfter' | 'validBefore' | 'nonce' | 'signature'>,
): Promise<string> {
  const usdc = new Contract(usdcAddress, USDC_ABI, provider);
  const [name, version, network] = await Promise.all([
    usdc.getFunction('name')() as Promise<string>,
    usdc.getFunction('version')() as Promise<string>,
    provider.getNetwork(),
  ]);
  return verifyTypedData(
    { name, version, chainId: network.chainId, verifyingContract: usdcAddress },
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
    auth.signature,
  );
}

/** Submit the authorisation on chain — the SUBMITTER pays the gas, not the signer. */
export async function submitTransferAuthorization(
  relayer: Wallet,
  usdcAddress: string,
  auth: Pick<StealthAuthPayload, 'from' | 'to' | 'value' | 'validAfter' | 'validBefore' | 'nonce' | 'signature'>,
): Promise<{ txHash: string; blockNumber: number }> {
  const usdc = new Contract(usdcAddress, USDC_ABI, relayer);
  const sig = auth.signature.startsWith('0x') ? auth.signature.slice(2) : auth.signature;
  const r = `0x${sig.slice(0, 64)}`;
  const s = `0x${sig.slice(64, 128)}`;
  const v = Number.parseInt(sig.slice(128, 130), 16);

  const tx = await usdc.getFunction('transferWithAuthorization')(
    auth.from,
    auth.to,
    BigInt(auth.value),
    BigInt(auth.validAfter),
    BigInt(auth.validBefore),
    auth.nonce,
    v,
    r,
    s,
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`transferWithAuthorization failed: ${tx.hash}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

export function createBaseStealthBackend(config: BaseStealthConfig): PaymentBackend {
  const log = config.log ?? (() => {});
  const announcerAddress = config.announcerAddress ?? ERC5564_ANNOUNCER;
  /** The one-shot derivation carried between quote() and authorize(). */
  let pending: StealthPayment | undefined;

  return {
    rail: 'base-stealth',

    async quote(request: QuoteRequest): Promise<PaymentQuote> {
      const metaAddress = config.recipientMetaAddress ?? request.recipient;
      if (!metaAddress.startsWith('st:')) {
        throw new Error(
          `base-stealth: recipient must be an ERC-5564 meta-address ("st:base:0x…"), received: ${metaAddress.slice(0, 24)}…`,
        );
      }
      // A FRESH ephemeral key FOR EVERY JOB — reusing one links two payments together.
      pending = deriveStealthPayment(metaAddress, hexlify(randomBytes(32)));
      log(`[base-stealth] fresh stealth address derived: ${pending.stealthAddress}`);

      return {
        rail: 'base-stealth',
        intentHash: request.intentHash,
        amount: request.amount,
        asset: 'USDC',
        decimals: 6,
        payTo: pending.stealthAddress,
        http402: {
          scheme: 'exact',
          network: 'base-sepolia',
          asset: config.usdcAddress,
          amount: request.amount,
          payTo: pending.stealthAddress,
        },
        expiresAt: Date.now() + 3_600_000,
      };
    },

    async authorize(quote: PaymentQuote): Promise<AuthProof> {
      if (!pending) throw new Error('base-stealth: authorize() was called without quote()');
      const auth = await signTransferAuthorization({
        provider: config.provider,
        usdcAddress: config.usdcAddress,
        signerPrivateKey: config.payerPrivateKey,
        to: quote.payTo,
        value: BigInt(quote.amount),
      });
      log('[base-stealth] EIP-3009 authorisation signed — the money has NOT moved YET');

      return {
        rail: 'base-stealth',
        intentHash: quote.intentHash,
        payTo: quote.payTo,
        amount: quote.amount,
        payload: {
          ...auth,
          ephemeralPublicKey: pending.ephemeralPublicKey,
          viewTag: pending.viewTag,
          metadata: pending.metadata,
        } satisfies StealthAuthPayload,
      };
    },

    async verifyAuthorization(proof, expected) {
      if (proof.rail !== 'base-stealth') return { ok: false, reason: `wrong rail: ${proof.rail}` };
      if (proof.intentHash.toLowerCase() !== expected.intentHash.toLowerCase()) {
        return { ok: false, reason: 'the authorisation belongs to a different job' };
      }
      if (proof.amount !== expected.amount) {
        return { ok: false, reason: `tutar ${proof.amount}, beklenen ${expected.amount}` };
      }

      const auth = proof.payload as StealthAuthPayload;
      if (auth.to.toLowerCase() !== proof.payTo.toLowerCase()) {
        return { ok: false, reason: 'the recipient in the authorisation differs from the declared payTo' };
      }
      if (BigInt(auth.value) !== BigInt(expected.amount)) {
        return { ok: false, reason: 'the signed amount differs from the expected one' };
      }
      if (BigInt(auth.validBefore) <= BigInt(Math.floor(Date.now() / 1000))) {
        return { ok: false, reason: 'the authorisation has expired' };
      }

      // IS THIS PAYMENT MINE? Does the stealth address derive from my meta-address?
      // The ephemeral pubkey travels with the authorisation, so we can check this with the
      // viewing key — a payment made to someone else is eliminated here.
      if (config.viewingPrivateKey && config.spendingPublicKey) {
        const mine = checkAnnouncement(
          { viewingPrivateKey: config.viewingPrivateKey, spendingPublicKey: config.spendingPublicKey },
          auth.ephemeralPublicKey,
        );
        if (!mine || mine.stealthAddress.toLowerCase() !== auth.to.toLowerCase()) {
          return { ok: false, reason: 'the stealth address does not derive from this agent\'s meta-address' };
        }
      }

      // Does the signature really belong to the payer? Rebuild the EIP-3009 digest and recover.
      const signer = await recoverTransferAuthorizationSigner(config.provider, config.usdcAddress, auth);
      if (signer.toLowerCase() !== auth.from.toLowerCase()) {
        return { ok: false, reason: `signature yields ${signer}, declared payer is ${auth.from}` };
      }

      // Is the balance sufficient? If not, we risk doing the work and failing to collect.
      const usdc = new Contract(config.usdcAddress, USDC_ABI, config.provider);
      const balance = (await usdc.getFunction('balanceOf')(auth.from)) as bigint;
      if (balance < BigInt(auth.value)) {
        return { ok: false, reason: `payer's balance is insufficient (${balance})` };
      }

      return { ok: true };
    },

    async settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt> {
      // THE GATE: no money is released for an unverified job.
      const verified = await assertJobVerified(
        config.provider,
        config.verifierAddress,
        jobVerifiedTx,
        proof.intentHash,
      );

      const auth = proof.payload as StealthAuthPayload;
      const relayer = new Wallet(config.relayerPrivateKey, config.provider);

      const { txHash, blockNumber } = await submitTransferAuthorization(relayer, config.usdcAddress, auth);
      log(`[base-stealth] USDC arrived at the stealth address: ${txHash}`);

      // The ERC-5564 announcement: so Bob can find his money by scanning. The Announcer is
      // LIVE on Base Sepolia, no out-of-band fallback is needed.
      const announcer = new Contract(announcerAddress, ANNOUNCER_ABI, relayer);
      const announceTx = await announcer.getFunction('announce')(
        SCHEME_ID,
        auth.to,
        auth.ephemeralPublicKey,
        auth.metadata,
      );
      await announceTx.wait();
      log(`[base-stealth] ERC-5564 duyurusu: ${announceTx.hash}`);

      return {
        rail: 'base-stealth',
        intentHash: proof.intentHash,
        txRef: txHash,
        explorerUrl: `${BASESCAN}/tx/${txHash}`,
        settledAt: Date.now(),
        jobVerifiedTx,
        jobVerifiedBlock: verified.blockNumber,
      };
    },

    async verify(receipt: Receipt): Promise<boolean> {
      const r = await config.provider.getTransactionReceipt(receipt.txRef);
      return r?.status === 1;
    },
  };
}

export { BASESCAN, TRANSFER_WITH_AUTHORIZATION_TYPES };
