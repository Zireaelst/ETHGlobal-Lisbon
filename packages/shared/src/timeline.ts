// timeline.ts — iş yaşam döngüsü taahhütleri (BUILD-PLAN P4-D).
//
// Beş aşama, her biri Hedera'nın consensus timestamp'iyle HCS topic'ine yazılıyor.
// Topic'e YALNIZCA TAAHHÜT gider: brief, veri ve çıktı asla. Gizlenen şey işin NE
// olduğu; gizlenmeyen şey işin OLDUĞU. Zaman çizelgesi bilerek şeffaflık katmanı.
//
// Bu dosyada Hedera SDK'sı YOK — sadece tipler ve doğrulama. Sebebi mimari:
// `@ca/bob-binding` (enclave, imageHash ile ölçülüyor) `@ca/shared`'a bağımlı;
// buraya Hedera SDK'sı koysaydık enclave imajı gereksiz şişerdi. Yazma/okuma işi
// `@ca/payment/src/hcs-timeline.ts` içinde.

import { z } from 'zod';

export const TIMELINE_STAGES = [
  '402_ISSUED',
  'INTENT_COMMIT',
  'ENCLAVE_INVOKED',
  'OUTPUT_COMMIT',
  'SETTLED',
] as const;

export type TimelineStage = (typeof TIMELINE_STAGES)[number];

const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, '0x + 64 hex hane olmalı');

/** Taahhüdü kimin yazdığı — kayıt kimin iddiası olduğu konusunda dürüst kalsın. */
export const TimelineAuthorSchema = z.enum(['client', 'agent']);

const base = {
  v: z.literal(1),
  intentHash: Bytes32,
  by: TimelineAuthorSchema,
};

export const TimelineEventSchema = z.discriminatedUnion('stage', [
  z.object({
    ...base,
    stage: z.literal('402_ISSUED'),
    price: z.string().regex(/^\d+$/),
    currency: z.string().min(1),
    rail: z.string().min(1),
  }),
  z.object({
    ...base,
    stage: z.literal('INTENT_COMMIT'),
    client: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    agentId: z.string().regex(/^\d+$/),
    deadline: z.string().regex(/^\d+$/),
  }),
  z.object({
    ...base,
    stage: z.literal('ENCLAVE_INVOKED'),
    agentId: z.string().regex(/^\d+$/),
    /**
     * Ölçülmüş enclave imajının hash'i. Gerçek Tapp bağlanana kadar `null` —
     * UYDURULMAZ. `attestation` alanı neyimiz olduğunu açıkça söylüyor.
     */
    imageHash: Bytes32.nullable(),
    attestation: z.enum(['none', 'tee-attested']),
    /** Gövdeyi imzalayan anahtar — elimizde GERÇEKTEN olan şey. */
    bindingSigner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
  z.object({
    ...base,
    stage: z.literal('OUTPUT_COMMIT'),
    outputHash: Bytes32,
    match: z.boolean(),
    /** 0G TEE imza durumu — yoksa false, sessizce true yazılmaz. */
    ogVerified: z.boolean(),
    computeProvider: z.enum(['none', '0g-sealed-inference', 'fixture-replay']),
  }),
  z.object({
    ...base,
    stage: z.literal('SETTLED'),
    rail: z.string().min(1),
    txId: z.string().min(1),
    /** Ödemeyi serbest bırakan JobVerified işlemi — sıra kanıtının çıpası. */
    jobVerifiedTx: z.string().min(1),
  }),
]);

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/** Mirror node'dan okunan, consensus bilgisi eklenmiş kayıt. */
export interface RecordedTimelineEvent {
  event: TimelineEvent;
  sequenceNumber: number;
  consensusTimestamp: string;
}

/**
 * Bir taahhüdün düz metin sızdırmadığını doğrula.
 *
 * Kapı bunu kullanıyor ama üretim yolunda da çağrılıyor: yanlışlıkla brief ya da
 * çıktı eklenmiş bir olay topic'e ÇIKMADAN önce burada patlar.
 */
export function assertNoPlaintext(event: TimelineEvent, secrets: string[]): void {
  const serialized = JSON.stringify(event);
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    // Uzun metinlerin parçaları da sızıntıdır; 16 karakterlik pencerelerle bak.
    for (let i = 0; i + 16 <= secret.length; i += 16) {
      if (serialized.includes(secret.slice(i, i + 16))) {
        throw new Error(
          `timeline: ${event.stage} olayı düz metin sızdırıyor ("${secret.slice(i, i + 16)}") — ` +
            'topic\'e yalnızca taahhüt gider',
        );
      }
    }
    if (serialized.includes(secret)) {
      throw new Error(`timeline: ${event.stage} olayı düz metin sızdırıyor`);
    }
  }
}

/** Aşamaların beklenen mantıksal sırası. */
export function stageOrder(stage: TimelineStage): number {
  return TIMELINE_STAGES.indexOf(stage);
}
