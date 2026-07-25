// fraud.ts — Bob'un ENCLAVE DIŞI hile katmanı (BUILD-PLAN P1-D).
//
// Buradaki kod enclave'e girmez. `@ca/bob-binding` içindeki binding her koşulda dürüst
// çalışır; hile ancak enclave'e giden iş emrini ya da enclave'den dönen imzayı DEĞİŞTİREREK
// yapılabilir. Demonun tek cümlelik iddiası bu ayrımdan geliyor:
// "Bob hile yapabilir ama enclave onun adına yalan söyleyemez."
//
// | Mod         | Bob ne yapıyor                                  | Beklenen sonuç          |
// |-------------|--------------------------------------------------|-------------------------|
// | none        | normal                                           | JobVerified             |
// | substitute  | enclave'e FARKLI bir brief besler                 | match:false             |
// | tamper      | data'nın bir byte'ını değiştirir                  | match:false             |
// | forge       | gövdeyi enclave-DIŞI bir anahtarla imzalar        | BadEnclaveSig           |
// | selfintent  | kendi intent'ini uydurur, Alice imzası yok        | BadClientSig            |

import type { BindingRequest, BindingResponse } from '@ca/bob-binding';
import { buildIntentHash, signSeal, type Constraints } from '@ca/shared';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

export const FRAUD_MODES = ['none', 'substitute', 'tamper', 'forge', 'selfintent'] as const;
export type FraudMode = (typeof FRAUD_MODES)[number];

export function isFraudMode(v: unknown): v is FraudMode {
  return typeof v === 'string' && (FRAUD_MODES as readonly string[]).includes(v);
}

/** Her mod için kontratın vereceği kararın FAZ 1 karşılığı — kapı bunu bekliyor. */
export const EXPECTED_OUTCOME: Record<FraudMode, string> = {
  none: 'JobVerified',
  substitute: 'MatchFalse',
  tamper: 'MatchFalse',
  forge: 'BadEnclaveSig',
  selfintent: 'BadClientSig',
};

export interface FraudContext {
  /** Alice'in gerçekten imzaladığı intent bilgisi (selfintent bunu atacak). */
  claimedIntentHash: string;
  clientSignatureValid: boolean;
}

/**
 * Enclave'e GİRMEDEN ÖNCE iş emrini boz.
 *
 * `substitute` ve `tamper` burada olur; ikisi de enclave'in yeniden hesapladığı
 * taahhüdü Alice'inkinden ayırır ve `match:false` üretir.
 */
export function applyPreBindingFraud(
  mode: FraudMode,
  request: BindingRequest,
  ctx: FraudContext,
): { request: BindingRequest; ctx: FraudContext } {
  switch (mode) {
    case 'substitute':
      // Bob sipariş edilen işi değil, BAŞKA bir işi cevaplatıyor.
      return {
        request: {
          ...request,
          brief: 'Write a short generic market summary. (Bob substituted this brief.)',
        },
        ctx,
      };

    case 'tamper': {
      // Girdi verisinin tek bir byte'ı değişiyor — en sinsi saldırı.
      const data = request.data;
      const i = Math.floor(data.length / 2);
      const ch = data[i] === '0' ? '1' : '0';
      return { request: { ...request, data: `${data.slice(0, i)}${ch}${data.slice(i + 1)}` }, ctx };
    }

    case 'selfintent': {
      // Bob kendi işini uyduruyor: içerikle TUTARLI bir intentHash üretiyor, böylece
      // enclave match:true diyor — ama bu hash'i Alice imzalamadı. Reddi client
      // imzası kontrolü verecek (kontratta BadClientSig).
      const forgedBrief = 'Bob invented this job so he could claim payment for it.';
      const forgedIntentHash = buildIntentHash({
        brief: forgedBrief,
        data: request.data,
        constraints: request.constraints,
        price: request.price,
        nonce: request.nonce,
      });
      return {
        request: { ...request, brief: forgedBrief, claimedIntentHash: forgedIntentHash },
        ctx: { claimedIntentHash: forgedIntentHash, clientSignatureValid: false },
      };
    }

    case 'none':
    case 'forge':
      return { request, ctx };
  }
}

/**
 * Enclave'den DÖNDÜKTEN sonra sonucu boz.
 *
 * `forge`: gövde doğru ama imza enclave'in anahtarıyla değil, Bob'un kendi anahtarıyla
 * atılıyor. Kayıtlı `enclaveSignerOf[agentId]` ile uyuşmadığı için kontrat reddedecek.
 */
export function applyPostBindingFraud(mode: FraudMode, response: BindingResponse): BindingResponse {
  if (mode !== 'forge') return response;

  // Deterministik "sahte" anahtar — demo tekrar edilebilir olsun diye rastgele değil.
  const rogueKey = keccak256(toUtf8Bytes('bob-rogue-key/not-the-enclave'));
  const rogue = new Wallet(rogueKey);
  // Gövde DOĞRU kalıyor; sadece imza enclave'in anahtarıyla değil Bob'unkiyle atılıyor.
  // Kontrat `enclaveSignerOf[agentId]` ile uyuşmadığı için BadEnclaveSig verecek.
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
