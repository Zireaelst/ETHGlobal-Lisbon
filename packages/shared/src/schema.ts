// schema.ts — tel üzerindeki (wire) formatların zod şemaları (BUILD-PLAN §2.3).
//
// Amaç: iki agent arasındaki SESSİZ uyuşmazlığı öldürmek. Bozuk bir paket 500 ile
// çökmek yerine 400 ile reddedilir (P1-C kapı kriteri).
//
// bigint kuralı: JSON bigint taşıyamaz. `price`, `deadline` ve `nonce` tel üzerinde
// DECIMAL STRING'dir; `toWire`/`fromWire` dönüşümü tek yerde yapılır. Bir yerde bigint
// bir yerde number kullanmak, hash'i sessizce değiştiren en sinsi hata sınıfıdır.

import { z } from 'zod';
import type { Constraints, Intent } from './intent.js';

const hex = (bytes: number) =>
  z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`), `0x + ${bytes * 2} hex hane olmalı`);

export const Bytes32Schema = hex(32);
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'EVM adresi olmalı');
export const SignatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/, '65-byte imza olmalı (r‖s‖v)');
/** Negatif olmayan tamsayı, decimal string. */
export const UintStringSchema = z.string().regex(/^\d+$/, 'decimal string olmalı (JSON bigint taşımaz)');

/** Kanonik ECIES public key: 0x04 + 128 hex (bkz. ecies.ts). */
export const EciesPubKeySchema = z
  .string()
  .regex(/^0x04[0-9a-fA-F]{128}$/, 'kanonik ECIES public key olmalı (0x04 + 128 hex)');

export const ConstraintsSchema = z
  .object({
    model: z.string().min(1),
    maxTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2),
  })
  .passthrough();

/** Alice'in imzaladığı yapının tel hâli. */
export const IntentWireSchema = z.object({
  intentHash: Bytes32Schema,
  client: AddressSchema,
  agentId: Bytes32Schema,
  price: UintStringSchema,
  deadline: UintStringSchema,
});
export type IntentWire = z.infer<typeof IntentWireSchema>;

/** Alice → Bob `/task`, ECIES ile şifrelenen İÇERİK. */
export const TaskEnvelopeSchema = z.object({
  v: z.literal(1),
  intent: IntentWireSchema,
  aliceSig: SignatureSchema,
  brief: z.string(),
  data: z.string(),
  constraints: ConstraintsSchema,
  nonce: UintStringSchema,
  /** Alice'in ECIES pubkey'i — sonuç buna şifrelenir (kanonik biçim). */
  replyPubKey: EciesPubKeySchema,
});
export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;

/** Ödeme rayı kimliği — iki backend, tek arayüz. */
export const PaymentRailSchema = z.enum(['base-stealth', 'hedera-x402']);

/**
 * Bob'un HTTP 402 yanıtı: "önce ödeme yetkisi ver".
 *
 * `recipient` bir ADRES DEĞİL, bir TARİF: Base'de Bob'un ERC-5564 meta-adresi
 * (Alice ondan TAZE bir stealth adres türetir — Bob bunu önceden bilemez),
 * Hedera'da düz hesap kimliği.
 */
export const PaymentRequirementsSchema = z.object({
  rail: PaymentRailSchema,
  intentHash: Bytes32Schema,
  amount: UintStringSchema,
  asset: z.string().min(1),
  decimals: z.number().int().min(0).max(18),
  recipient: z.string().min(1),
  network: z.string().min(1),
  expiresAt: z.number().int().positive(),
});
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

/**
 * Alice'in imzaladığı, HENÜZ GÖNDERİLMEMİŞ ödeme yetkisi.
 *
 * `payload` raya özgü (Base: EIP-3009 imzası; Hedera: kısmi imzalı transfer).
 * Bob bunu doğrular, işi yapar, `JobVerified` sonrası gönderir.
 */
export const PaymentAuthorizationSchema = z.object({
  rail: PaymentRailSchema,
  intentHash: Bytes32Schema,
  payTo: z.string().min(1),
  amount: UintStringSchema,
  payload: z.unknown(),
});
export type PaymentAuthorization = z.infer<typeof PaymentAuthorizationSchema>;

/**
 * Tel üzerindeki dış gövde: POST /task
 *
 * `intentHash` ve `replyPubKey` ŞİFRE DIŞINDA taşınıyor çünkü Bob'un dış katmanı
 * paketi ÇÖZEMİYOR (anahtar enclave'de) ama işi yönlendirmek ve sonucu teslim etmek
 * için bu ikisine ihtiyacı var. Sızıntı yok: `intentHash` zaten `JobVerified` ile
 * zincirde herkese açık, `replyPubKey` de Alice'in ERC-8004 kaydında duruyor.
 *
 * Enclave bunlara GÜVENMEZ — kendi kararlarını paketin İÇİNDEKİ alanlardan verir.
 */
export const TaskRequestSchema = z.object({
  to: z.string().min(1),
  intentHash: Bytes32Schema,
  replyPubKey: EciesPubKeySchema,
  cipher: z.string().min(1),
  /**
   * Ödeme yetkisi. YOKSA Bob 402 döner ve İŞ YAPMAZ (CLAUDE.md §7).
   *
   * Bu bir EMANET (escrow) değil, imzalanmış bir izindir: para hâlâ Alice'in
   * cüzdanında. Bob onu tutar, işi yapar ve `JobVerified` çıktıktan SONRA
   * gönderir. Fraud koşusunda `JobVerified` hiç oluşmaz → yetki hiç gönderilmez.
   */
  payment: PaymentAuthorizationSchema.optional(),
});
export type TaskRequest = z.infer<typeof TaskRequestSchema>;

/**
 * Enclave'in imzaladığı gövdenin ÇÖZÜLMÜŞ hâli.
 *
 * Gövdenin kendisi JSON DEĞİL — `abi.encode(bytes32,bytes32,bool,bytes32)`.
 * Sebebi §2.3: kontrat gövdeyi alanlardan yeniden üretebilsin, JSON parse etmesin.
 * Bu şema yalnızca çözülmüş hâli doğrular.
 */
export const TappBodySchema = z.object({
  intentHash: Bytes32Schema,
  outputHash: Bytes32Schema,
  match: z.boolean(),
  /** keccak256(ogSig) — imzanın kendisi değil, taahhüdü. */
  ogSigHash: Bytes32Schema,
});
export type TappBody = z.infer<typeof TappBodySchema>;

/** Tapp seal imzası — `v` wrapper tarafından atıldığı için sadece r‖s taşınır. */
export const SealSchema = z.object({
  agentId: z.string().min(1),
  sealId: z.string().min(1),
  timestamp: z.string().min(1),
  r: Bytes32Schema,
  s: Bytes32Schema,
});
export type Seal = z.infer<typeof SealSchema>;

/** Bob → Alice, Alice'in replyPubKey'ine ECIES. */
export const ResultEnvelopeSchema = z.object({
  v: z.literal(1),
  output: z.string(),
  /** İmzalanan ham gövdenin hex hâli — yeniden stringify EDİLMEZ. */
  bodyHex: z.string().regex(/^0x[0-9a-fA-F]*$/, 'hex olmalı'),
  seal: SealSchema,
  ogSig: z.string().min(1),
  ogSigner: AddressSchema,
  /** 0G Storage kökü (P3-E bonusu). */
  storageRoot: Bytes32Schema.optional(),
  /** İmza içeride doğrulanamadıysa false — sessizce true yazılmaz (P3-B kuralı). */
  ogVerified: z.boolean(),
});
export type ResultEnvelope = z.infer<typeof ResultEnvelopeSchema>;

/** Bob'un `GET /.well-known/agent-card.json` yanıtı. */
export const AgentCardSchema = z.object({
  v: z.literal(1),
  name: z.string().min(1),
  /** ERC-8004 agentId, decimal string. */
  agentId: UintStringSchema,
  owner: AddressSchema,
  skills: z.array(z.string().min(1)).min(1),
  endpoint: z.string().url(),
  eciesPubKey: EciesPubKeySchema,
  price: z.object({
    amount: UintStringSchema,
    asset: z.string().min(1),
    decimals: z.number().int().min(0).max(18),
  }),
  /** ERC-5564 stealth meta-address (P4-B). Henüz yoksa null. */
  stealthMetaAddress: z.string().nullable(),
  /**
   * Hedera ödeme hesabı (P4-C). Alıcı gizliliği YOK — roadmap v3 §07 bilinçli kararı.
   *
   * `.default()` KULLANMIYORUZ: default'lu bir alan zod'un girdi ve çıktı tiplerini
   * ayırıyor, `parseOrThrow`'un jeneriği de girdiye bağlanıp alanı opsiyonel sanıyor.
   * Alanı zorunlu-nullable bırakmak hem tipleri hizalıyor hem de eksik alanı sessizce
   * doldurmak yerine reddediyor.
   */
  hederaAccount: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Hedera hesap kimliği olmalı')
    .nullable(),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;

/**
 * FAZ 1 sonucu — enclave ve 0G henüz yok.
 *
 * Bilerek `ResultEnvelope`'tan AYRI: seal/ogSig alanlarını sahte değerlerle
 * doldurmak, henüz sahip olmadığımız bir güvenceyi varmış gibi gösterirdi.
 * P3-B gerçek gövdeyi imzalamaya başlayınca akış `ResultEnvelope`'a geçer.
 */
export const EchoResultSchema = z.object({
  v: z.literal(1),
  stage: z.literal('echo'),
  /** Alice'in imzaladığı taahhüt. */
  intentHash: Bytes32Schema,
  /** Bob'un paketten yeniden hesapladığı taahhüt. */
  recomputedIntentHash: Bytes32Schema,
  match: z.boolean(),
  /** Alice'in EIP-712 imzasından kurtarılan adres beklenen client mı? */
  clientSigOk: z.boolean(),
  recoveredClient: AddressSchema,
  output: z.string(),

  // --- binding imzası (P1-D) ---
  // DİKKAT: bu, doğrulanmış Tapp seal imzası DEĞİL. FAZ 1'de binding yerel bir
  // fonksiyon ve anahtar attested enclave'den gelmiyor. P3-B/P3-C gerçeğiyle değiştirecek.
  /** İmzalanan ham gövde: abi.encode(bytes32,bytes32,bool,bytes32). */
  bodyHex: z.string().regex(/^0x[0-9a-fA-F]*$/, 'hex olmalı'),
  /** Seal imzası — `v` atılmış, sadece r‖s (CLAUDE.md §3.1B). Kontrat iki pariteyi de dener. */
  seal: SealSchema,
  /** Gövde imzasından kurtarılan adres. */
  bindingSigner: AddressSchema,
  /** Kayıtlı binding anahtarı — kontrattaki enclaveSignerOf'un FAZ 1 karşılığı. */
  expectedBindingSigner: AddressSchema,
  bindingSigOk: z.boolean(),

  // --- 0G attestation durumu (compute.ts sınırından gelir) ---
  // `provider: 'none'` ve `ogVerified: false` DÜRÜST bir cevaptır: sistem
  // "burada TEE imzası yok" der; sahte imza üretmez.
  computeProvider: z.enum(['none', '0g-sealed-inference', 'fixture-replay']),
  ogVerified: z.boolean(),
  ogSig: z.string().optional(),
  ogSigner: AddressSchema.optional(),
});
export type EchoResult = z.infer<typeof EchoResultSchema>;

// ---------------------------------------------------------------------------
// bigint <-> wire dönüşümü — TEK yerde
// ---------------------------------------------------------------------------

export function intentToWire(intent: Intent): IntentWire {
  return {
    intentHash: intent.intentHash,
    client: intent.client,
    agentId: intent.agentId,
    price: intent.price.toString(),
    deadline: intent.deadline.toString(),
  };
}

export function intentFromWire(wire: IntentWire): Intent {
  return {
    intentHash: wire.intentHash,
    client: wire.client,
    agentId: wire.agentId,
    price: BigInt(wire.price),
    deadline: BigInt(wire.deadline),
  };
}

/** Şemadan geçmeyen paketi anlamlı hatayla reddet (çağıran 400 döner). */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((i) => `${i.path.join('.') || '(kök)'}: ${i.message}`)
    .join('; ');
  throw new Error(`${what} şemadan geçmedi — ${detail}`);
}

export type { Constraints };
