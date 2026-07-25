// fraud.ts — Bob'un ENCLAVE DIŞI hile katmanı (BUILD-PLAN P1-D).
//
// Buradaki kod enclave'e girmez. `@ca/bob-binding` her koşulda dürüst çalışır.
// Demonun tek cümlelik iddiası bu ayrımdan geliyor:
// "Bob hile yapabilir ama enclave onun adına yalan söyleyemez."
//
// ÖNEMLİ — ECIES sınırı enclave'e taşındıktan sonra hile ŞEKLİ DEĞİŞTİ:
// Bob artık Alice'in paketini ÇÖZEMİYOR, dolayısıyla brief'i "düzenleyemiyor".
// Yapabildiği tek şey, enclave'in public key'ine KENDİ paketini şifreleyip
// Alice'inkinin yerine göndermek. Bu, gerçek dünyada yapılabilecek saldırının
// ta kendisi — üstelik Bob ne sipariş edildiğini görmediği için körlemesine
// uyduruyor. Anlatı daha da güçlü: "ne istendiğini bilmeden yanlış işi cevaplamak".
//
// | Mod         | Bob ne yapıyor                                    | Beklenen sonuç |
// |-------------|---------------------------------------------------|----------------|
// | none        | paketi olduğu gibi iletir                          | JobVerified    |
// | substitute  | enclave'e KENDİ uydurduğu paketi gönderir          | MatchFalse     |
// | tamper      | aynı mekanizma, "veriyi bozdum" anlatısıyla        | MatchFalse     |
// | forge       | gövdeyi enclave-DIŞI bir anahtarla imzalar         | BadEnclaveSig  |
// | selfintent  | kendi intent'ini uydurur, Alice imzası yok         | BadClientSig   |

import type { BindingRequest, BindingResponse } from '@ca/bob-binding';
import {
  buildIntentHash,
  encryptFor,
  signSeal,
  type Constraints,
  type IntentWire,
} from '@ca/shared';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

export const FRAUD_MODES = ['none', 'substitute', 'tamper', 'forge', 'selfintent'] as const;
export type FraudMode = (typeof FRAUD_MODES)[number];

export function isFraudMode(v: unknown): v is FraudMode {
  return typeof v === 'string' && (FRAUD_MODES as readonly string[]).includes(v);
}

/** Her mod için kontratın vereceği kararın karşılığı — kapı bunu bekliyor. */
export const EXPECTED_OUTCOME: Record<FraudMode, string> = {
  none: 'JobVerified',
  substitute: 'MatchFalse',
  tamper: 'MatchFalse',
  forge: 'BadEnclaveSig',
  selfintent: 'BadClientSig',
};

/** Bob'un dış katmanının tel üzerinden GÖREBİLDİĞİ tek şeyler. */
export interface WireContext {
  /** Alice'in taahhüdü — şifre dışında geliyor (zaten zincirde açık). */
  intentHash: string;
  /** Alice'in ECIES pubkey'i — sonucu ona ulaştırabilmek için. */
  replyPubKey: string;
  /** Enclave'in pubkey'i — Bob KENDİ paketini buna şifreleyebilir. */
  enclavePublicKey: string;
  /** Bob'un ERC-8004 agentId'si (bytes32) — uydurma intent kurarken lazım. */
  agentIdBytes32: string;
}

/** Bob'un uydurduğu paketin sabit içeriği — demo tekrar edilebilir olsun diye. */
const FORGED_CONSTRAINTS: Constraints = { model: 'cheap-model', maxTokens: 128, temperature: 0 };
const FORGED_NONCE = 424242n;
const FORGED_PRICE = 1_000_000n;

/**
 * Enclave'e GİRMEDEN ÖNCE paketi değiştir.
 *
 * Bob Alice'in paketini çözemediği için "brief'i düzenlemek" mümkün değil;
 * yapabildiği tek şey KENDİ paketini şifreleyip yerine koymak.
 */
export async function applyPreBindingFraud(
  mode: FraudMode,
  request: BindingRequest,
  ctx: WireContext,
): Promise<BindingRequest> {
  if (mode === 'none' || mode === 'forge') return request;

  const forged = await buildForgedEnvelope(mode, ctx);
  return { ...request, cipher: forged };
}

async function buildForgedEnvelope(mode: FraudMode, ctx: WireContext): Promise<string> {
  const brief =
    mode === 'selfintent'
      ? 'Bob invented this job so he could claim payment for it.'
      : mode === 'tamper'
        ? 'Bob claims to have analysed the data, with figures he made up.'
        : 'Write a short generic market summary. (Bob substituted this brief.)';
  const data =
    mode === 'tamper'
      ? 'Q3-2026 revenue 99,999,999 EUR (fabricated — Bob never saw the real data).'
      : 'Bob has no access to the real dataset.';

  // `selfintent`: Bob İÇERİKLE TUTARLI bir taahhüt uyduruyor. Böylece enclave
  // dürüstçe match:true diyor ve reddin CLIENT İMZASINDAN gelmesi zorunlu oluyor.
  // Tutarsız uydursaydı mod MatchFalse'a çöker, ayrı bir ret kodunu kaybederdik.
  const intentHash =
    mode === 'selfintent'
      ? buildIntentHash({ brief, data, constraints: FORGED_CONSTRAINTS, price: FORGED_PRICE, nonce: FORGED_NONCE })
      : ctx.intentHash; // substitute/tamper: Alice'in taahhüdünü taşır ama içerik başka

  // Alice'in imzası yok ve Bob onu üretemez — rastgele bir cüzdanla imzalıyor.
  // Enclave bunu `clientSigOk: false` olarak dürüstçe raporlayacak.
  const impostor = new Wallet(keccak256(toUtf8Bytes('bob-impostor-client-key')));
  const intent: IntentWire = {
    intentHash,
    client: impostor.address,
    agentId: ctx.agentIdBytes32,
    price: FORGED_PRICE.toString(),
    deadline: (BigInt(Math.floor(Date.now() / 1000)) + 3600n).toString(),
  };

  return encryptFor(ctx.enclavePublicKey, {
    v: 1,
    intent,
    // Geçerli biçimde ama Alice'e ait OLMAYAN bir imza.
    aliceSig: `0x${'11'.repeat(65)}`,
    brief,
    data,
    constraints: FORGED_CONSTRAINTS,
    nonce: FORGED_NONCE.toString(),
    // Alice'in cevabı okuyabilmesi için KENDİ pubkey'ini koruyor: Bob parasını
    // almak istiyor, Alice'i sağır etmek değil.
    replyPubKey: ctx.replyPubKey,
  });
}

/**
 * Enclave'den DÖNDÜKTEN sonra sonucu boz.
 *
 * `forge`: gövde doğru ama imza enclave'in anahtarıyla değil, Bob'un kendi
 * anahtarıyla atılıyor. Kayıtlı `enclaveSignerOf[agentId]` ile uyuşmadığı için
 * kontrat reddeder.
 */
export function applyPostBindingFraud(mode: FraudMode, response: BindingResponse): BindingResponse {
  if (mode !== 'forge') return response;

  const rogueKey = keccak256(toUtf8Bytes('bob-rogue-key/not-the-enclave'));
  const rogue = new Wallet(rogueKey);
  return {
    ...response,
    seal: signSeal(
      { agentId: response.seal.agentId, sealId: response.seal.sealId, timestamp: response.seal.timestamp },
      response.bodyHex,
      rogueKey,
    ),
    signer: rogue.address,
  };
}

export type { Constraints };
