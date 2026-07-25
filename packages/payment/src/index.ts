// PaymentBackend — tek arayüz, iki ray (BUILD-PLAN P4-A).
//
// Üç aşama, x402'nin verify/settle ayrımına birebir oturuyor:
//
//   quote()      Bob'un 402 yanıtı — fiyat ve ödemenin gideceği yer
//   authorize()  Alice imzalar; PARA HAREKET ETMEZ
//   settle()     JobVerified'tan SONRA para hareket eder
//
// Ayrımın sebebi demonun en güçlü tek cümlesi: hile yapılan koşuda `JobVerified`
// hiç oluşmuyor, dolayısıyla `settle()` HİÇ ÇAĞRILMIYOR. "Ödeme asla settle olmadı."
//
// Bu kuralı bir konvansiyona bırakmıyoruz: `assertJobVerified` settlement'tan önce
// zincire bakıp o tx'in GERÇEKTEN bu `intentHash` için `JobVerified` yaydığını
// doğruluyor. Backend'ler onu çağırmak zorunda (kapı bunu test ediyor).
//
// Gizlilik farkı bilinçli ve roadmap v3 §07'de yazılı: stealth alıcı-gizliliği bir
// EVM konstrüksiyonu, Hedera'nın hesap modeline oturmuyor. Base koşusu gizliliği,
// Hedera koşusu OTONOMİYİ kanıtlıyor. İki ayrı kanıt, bir tane taviz verilmiş değil.

export type PaymentRail = 'base-stealth' | 'hedera-x402';

export interface QuoteRequest {
  /** Ödemenin bağlandığı iş. */
  intentHash: string;
  /** En küçük birim (USDC 6 hane, HBAR tinybar). */
  amount: string;
  /** Alıcının kayıtlı kimliği — Base'de bundan TAZE bir stealth adres türetilir. */
  recipient: string;
}

export interface PaymentQuote {
  rail: PaymentRail;
  intentHash: string;
  amount: string;
  asset: string;
  decimals: number;
  /**
   * Ödemenin gideceği yer.
   * Base: her iş için TAZE stealth adres — alıcının kayıtlı kimliğiyle bağlantısız.
   * Hedera: düz hesap kimliği — alıcı gizliliği YOK, bu bilinçli.
   */
  payTo: string;
  /** HTTP 402 gövdesi, olduğu gibi tel üzerinde taşınabilir. */
  http402: unknown;
  expiresAt: number;
}

export interface AuthProof {
  rail: PaymentRail;
  intentHash: string;
  payTo: string;
  amount: string;
  /** İmzalanmış ama GÖNDERİLMEMİŞ yetki. Bu noktada para hâlâ Alice'te. */
  payload: unknown;
}

export interface Receipt {
  rail: PaymentRail;
  intentHash: string;
  /** Zincire özgü işlem referansı. */
  txRef: string;
  explorerUrl: string;
  settledAt: number;
  /** Hangi JobVerified'a dayanarak settle edildi — SIRA kanıtının çıpası. */
  jobVerifiedTx: string;
  /** JobVerified'ın bloğu; settlement bundan SONRA olmalı. */
  jobVerifiedBlock?: number;
}

export interface PaymentBackend {
  readonly rail: PaymentRail;
  quote(request: QuoteRequest): Promise<PaymentQuote>;
  /** Alice yetkilendirir — para hareket etmez. */
  authorize(quote: PaymentQuote): Promise<AuthProof>;
  /**
   * Parayı hareket ettir. `jobVerifiedTx` ZORUNLU ve doğrulanır.
   * @throws SettlementNotAuthorizedError iş doğrulanmadıysa
   */
  settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt>;
  /** Makbuzu bağımsız olarak zincirden doğrula. */
  verify(receipt: Receipt): Promise<boolean>;
}

/** Settlement, doğrulanmamış bir iş için denendiğinde atılır. */
export class SettlementNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementNotAuthorizedError';
  }
}

export * from './guard.js';
