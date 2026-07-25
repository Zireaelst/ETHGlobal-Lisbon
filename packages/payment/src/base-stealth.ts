// base-stealth.ts — x402 + ERC-5564 stealth on Base Sepolia (GİZLİLİK koşusu).
//
// Bu ray alıcının kimliğini gizleyen olan. Bob bir meta-adres yayınlar; Alice her iş
// için TAZE bir stealth adres türetip oraya öder. Zincirde "bir adres USDC aldı"
// görünür, o adresin Bob'un ERC-8004 kimliğiyle bağı GÖRÜNMEZ.
//
// Hedera rayıyla farkı bilinçli (roadmap v3 §07): stealth alıcı-gizliliği bir EVM
// konstrüksiyonu, Hedera'nın hesap modeline oturmuyor. İki ayrı kanıt sunuyoruz.
//
// GAZ: Alice gas ÖDEMEZ. EIP-3009 `transferWithAuthorization` ile yetkiyi imzalar,
// işlemi bir relayer gönderir. Hedera'da bu rolü gerçek blocky402 facilitator'ı
// oynuyor; Base'de kendi relayer cüzdanımız oynuyor — README'de böyle yazılacak.
//
// STEALTH ADRESİN ETH'İ YOK ve OLMAMALI: adrese ETH göndermek onu gönderene
// bağlar ve gizliliği bozar. Bob da parayı EIP-3009 ile çıkarıyor — stealth anahtar
// yetkiyi imzalıyor, gas'ı yine relayer ödüyor. Böylece adres hiç ETH görmüyor.

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

/** ERC-5564 kanonik singleton'ları — ikisi de Base Sepolia'da canlı. */
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
  /** Alice — yetkiyi İMZALAR, gas ödemez. */
  payerPrivateKey: string;
  /**
   * İşlemi gönderen ve gas'ı ödeyen. Hedera'da bu rolü blocky402 oynuyor;
   * Base'de kendi cüzdanımız — dürüstçe "relayer" diye adlandırıldı.
   */
  relayerPrivateKey: string;
  usdcAddress: string;
  verifierAddress: string;
  /** Bob'un ERC-5564 meta-adresi (agent card / registry'den). */
  recipientMetaAddress?: string;
  announcerAddress?: string;
  /**
   * BOB tarafı: gelen ödemenin kendisine ait olduğunu doğrulamak için.
   * Görüntüleme anahtarı harcama yetkisi VERMEZ — sadece 'bu bana mı?' der.
   * Alice tarafında gerekmez.
   */
  viewingPrivateKey?: string;
  spendingPublicKey?: string;
  log?: (line: string) => void;
}

/** quote → authorize arasında taşınan, henüz GÖNDERİLMEMİŞ yetki. */
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

/** EIP-3009 yetkisi imzala — para HAREKET ETMEZ, sadece izin üretilir. */
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
 * EIP-3009 yetkisinin imzacısını kurtar — Bob'un "bu imza gerçekten ödeyene mi ait?"
 * kontrolü. Digest yapının KENDİ alanlarından yeniden üretilir; iddiaya güvenilmez.
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

/** Yetkiyi zincire gönder — gas'ı GÖNDEREN öder, imzalayan değil. */
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
  if (!receipt || receipt.status !== 1) throw new Error(`transferWithAuthorization başarısız: ${tx.hash}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

export function createBaseStealthBackend(config: BaseStealthConfig): PaymentBackend {
  const log = config.log ?? (() => {});
  const announcerAddress = config.announcerAddress ?? ERC5564_ANNOUNCER;
  /** quote() ile authorize() arasında taşınan tek seferlik türetme. */
  let pending: StealthPayment | undefined;

  return {
    rail: 'base-stealth',

    async quote(request: QuoteRequest): Promise<PaymentQuote> {
      const metaAddress = config.recipientMetaAddress ?? request.recipient;
      if (!metaAddress.startsWith('st:')) {
        throw new Error(
          `base-stealth: alıcı bir ERC-5564 meta-adresi olmalı ("st:base:0x…"), gelen: ${metaAddress.slice(0, 24)}…`,
        );
      }
      // HER İŞ İÇİN TAZE ephemeral anahtar — tekrar kullanmak iki ödemeyi bağlar.
      pending = deriveStealthPayment(metaAddress, hexlify(randomBytes(32)));
      log(`[base-stealth] taze stealth adres türetildi: ${pending.stealthAddress}`);

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
      if (!pending) throw new Error('base-stealth: authorize() quote() olmadan çağrıldı');
      const auth = await signTransferAuthorization({
        provider: config.provider,
        usdcAddress: config.usdcAddress,
        signerPrivateKey: config.payerPrivateKey,
        to: quote.payTo,
        value: BigInt(quote.amount),
      });
      log('[base-stealth] EIP-3009 yetkisi imzalandı — para HENÜZ hareket etmedi');

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
      if (proof.rail !== 'base-stealth') return { ok: false, reason: `yanlış ray: ${proof.rail}` };
      if (proof.intentHash.toLowerCase() !== expected.intentHash.toLowerCase()) {
        return { ok: false, reason: 'yetki başka bir işe ait' };
      }
      if (proof.amount !== expected.amount) {
        return { ok: false, reason: `tutar ${proof.amount}, beklenen ${expected.amount}` };
      }

      const auth = proof.payload as StealthAuthPayload;
      if (auth.to.toLowerCase() !== proof.payTo.toLowerCase()) {
        return { ok: false, reason: 'yetkideki alıcı ile beyan edilen payTo farklı' };
      }
      if (BigInt(auth.value) !== BigInt(expected.amount)) {
        return { ok: false, reason: 'imzalanan tutar beklenenden farklı' };
      }
      if (BigInt(auth.validBefore) <= BigInt(Math.floor(Date.now() / 1000))) {
        return { ok: false, reason: 'yetkinin süresi geçmiş' };
      }

      // BU ÖDEME BANA MI? Stealth adres benim meta-adresimden mi türetilmiş?
      // Geçici pubkey yetkiyle geldiği için bunu görüntüleme anahtarıyla
      // doğrulayabiliyoruz — başkasına yapılmış ödeme burada elenir.
      if (config.viewingPrivateKey && config.spendingPublicKey) {
        const mine = checkAnnouncement(
          { viewingPrivateKey: config.viewingPrivateKey, spendingPublicKey: config.spendingPublicKey },
          auth.ephemeralPublicKey,
        );
        if (!mine || mine.stealthAddress.toLowerCase() !== auth.to.toLowerCase()) {
          return { ok: false, reason: 'stealth adres bu agent\'ın meta-adresinden türetilmemiş' };
        }
      }

      // İmza gerçekten ödeyene mi ait? EIP-3009 digest'ini yeniden kurup kurtar.
      const signer = await recoverTransferAuthorizationSigner(config.provider, config.usdcAddress, auth);
      if (signer.toLowerCase() !== auth.from.toLowerCase()) {
        return { ok: false, reason: `imza ${signer} veriyor, beyan edilen ödeyen ${auth.from}` };
      }

      // Bakiye yetiyor mu? Yetmiyorsa iş yapıp sonra tahsil edememe riski var.
      const usdc = new Contract(config.usdcAddress, USDC_ABI, config.provider);
      const balance = (await usdc.getFunction('balanceOf')(auth.from)) as bigint;
      if (balance < BigInt(auth.value)) {
        return { ok: false, reason: `ödeyenin bakiyesi yetersiz (${balance})` };
      }

      return { ok: true };
    },

    async settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt> {
      // KAPI: doğrulanmamış iş için para serbest bırakılmaz.
      const verified = await assertJobVerified(
        config.provider,
        config.verifierAddress,
        jobVerifiedTx,
        proof.intentHash,
      );

      const auth = proof.payload as StealthAuthPayload;
      const relayer = new Wallet(config.relayerPrivateKey, config.provider);

      const { txHash, blockNumber } = await submitTransferAuthorization(relayer, config.usdcAddress, auth);
      log(`[base-stealth] USDC stealth adrese ulaştı: ${txHash}`);

      // ERC-5564 duyurusu: Bob taramayla parasını bulabilsin diye. Announcer
      // Base Sepolia'da CANLI, bant dışı fallback'e gerek yok.
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
