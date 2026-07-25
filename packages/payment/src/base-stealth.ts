// base-stealth.ts — x402 + ERC-5564 stealth on Base Sepolia (GİZLİLİK koşusu).
//
// Bu ray, alıcının kimliğini gizleyen olan. Bob bir "meta-adres" yayınlar; Alice her
// iş için ondan TAZE bir stealth adres türetir ve oraya öder. Zincirde "bir adres
// USDC aldı" görünür, ama o adresin Bob'un ERC-8004 kimliğiyle bağı YOKTUR.
//
// Hedera rayıyla farkı bilinçli (roadmap v3 §07): stealth alıcı-gizliliği bir EVM
// konstrüksiyonu, Hedera'nın hesap modeline oturmuyor. İki ayrı kanıt sunuyoruz,
// taviz verilmiş tek bir kanıt değil.
//
// ⚠️ DURUM: P4-B'de tamamlanacak. Arayüz sözleşmesi burada TAM; eksik olan ERC-5564
// türetmesi ve USDC transferi. Kritik kapı kriteri şu ve bilerek zor:
// "Bob stealth adresten parayı HARCAYABİLİYOR" — fonu çekip başka adrese göndererek
// kanıtlanacak. Sadece "adres ürettik" demek hiçbir şey kanıtlamaz.

import type { JsonRpcProvider } from 'ethers';
import {
  assertJobVerified,
  type AuthProof,
  type PaymentBackend,
  type PaymentQuote,
  type QuoteRequest,
  type Receipt,
} from './index.js';

const BASESCAN = 'https://sepolia.basescan.org';

export interface BaseStealthConfig {
  provider: JsonRpcProvider;
  /** Alice'in ödeme yapan cüzdanının private key'i. */
  payerPrivateKey: string;
  /** Base Sepolia USDC. */
  usdcAddress: string;
  verifierAddress: string;
  /** Bob'un ERC-5564 stealth meta-adresi (agent card / registry'den). */
  recipientMetaAddress?: string;
}

/** P4-B tamamlanana kadar atılan hata — sessizce yanlış davranmaktansa açıkça durur. */
export class StealthNotImplementedError extends Error {
  constructor(what: string) {
    super(
      `base-stealth: ${what} henüz uygulanmadı (BUILD-PLAN P4-B). ` +
        `USDC fonlaması ve ERC-5564 türetmesi o adımda geliyor.`,
    );
    this.name = 'StealthNotImplementedError';
  }
}

export function createBaseStealthBackend(config: BaseStealthConfig): PaymentBackend {
  return {
    rail: 'base-stealth',

    async quote(request: QuoteRequest): Promise<PaymentQuote> {
      // P4-B: recipientMetaAddress'ten ERC-5564 ile TAZE stealth adres türet.
      if (!config.recipientMetaAddress) {
        throw new StealthNotImplementedError('stealth meta-adres türetmesi');
      }
      throw new StealthNotImplementedError('stealth adres türetmesi');
      // Dönecek olan:
      // return { rail: 'base-stealth', intentHash: request.intentHash, amount: request.amount,
      //          asset: 'USDC', decimals: 6, payTo: <taze stealth adres>, http402, expiresAt };
    },

    async authorize(_quote: PaymentQuote): Promise<AuthProof> {
      // P4-B: EIP-3009 transferWithAuthorization imzası — Alice gas ÖDEMEZ,
      // para bu noktada HAREKET ETMEZ.
      throw new StealthNotImplementedError('EIP-3009 yetkilendirmesi');
    },

    async settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt> {
      // KAPI önce çalışır: doğrulanmamış iş için settle YOK. Bu kısım P4-B'den
      // bağımsız olarak şimdiden geçerli ve kapı tarafından test ediliyor.
      await assertJobVerified(config.provider, config.verifierAddress, jobVerifiedTx, proof.intentHash);
      throw new StealthNotImplementedError('USDC settlement');
    },

    async verify(receipt: Receipt): Promise<boolean> {
      const r = await config.provider.getTransactionReceipt(receipt.txRef);
      return r?.status === 1;
    },
  };
}

export { BASESCAN };
