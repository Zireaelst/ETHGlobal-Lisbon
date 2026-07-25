// hcs-timeline.ts — iş yaşam döngüsünü HCS topic'ine yazar (BUILD-PLAN P4-D).
//
// SIFIR SOLIDITY: HCS yerel bir Hedera servisi, EVM'in üstünde değil. Kontrat, deploy,
// ABI yok — yalnızca `TopicMessageSubmitTransaction` ve mirror node REST okuması.
//
// Roadmap'in Hedera farklılaştırıcısı burada: referans x402-hedera-example'da hiç
// HCS attestation yok; olsaydı bile bir ÖDEMEYİ attest ederdi. Biz 402'den settle'a
// kadar İŞİN TAMAMINI attest ediyoruz.
//
// SIRA GARANTİSİ + LATENCY: consensus sırası gönderim sırasını izliyor, o yüzden
// mesajlar ARDIŞIK gönderilmeli. Ama demoyu 5×~2 sn bekletmemek için `record()`
// gönderimi bir söz zincirine ekleyip HEMEN dönüyor; `flush()` hepsini bekliyor.
// Böylece hem sıra korunuyor hem kritik yol tıkanmıyor.

import { TopicMessageSubmitTransaction, type Client } from '@hiero-ledger/sdk';
import {
  TimelineEventSchema,
  type RecordedTimelineEvent,
  type TimelineEvent,
  assertNoPlaintext,
} from '@ca/shared';

const MIRROR_NODE_URL = 'https://testnet.mirrornode.hedera.com';
const HASHSCAN = 'https://hashscan.io/testnet';

export interface HcsTimelineConfig {
  /** Operatör client'ı — anahtar signer modülünde kalır (createHederaOperatorClient). */
  client: Client;
  topicId: string;
  /**
   * Topic'e çıkmaması gereken düz metinler (brief, veri, çıktı). Her olay
   * gönderilmeden ÖNCE bunlara karşı taranır — kaza eseri sızıntı ağa çıkmaz.
   */
  secrets?: string[];
  log?: (line: string) => void;
}

export interface SubmittedTimelineEvent {
  event: TimelineEvent;
  sequenceNumber: number;
}

export interface HcsTimeline {
  readonly topicId: string;
  readonly hashscanUrl: string;
  /** Olayı sıraya koy ve HEMEN dön. Gönderim arka planda, sırayı bozmadan yapılır. */
  record(event: TimelineEvent): void;
  /** Bekleyen tüm gönderimleri tamamla. */
  flush(): Promise<SubmittedTimelineEvent[]>;
  close(): void;
}

export function createHcsTimeline(config: HcsTimelineConfig): HcsTimeline {
  const log = config.log ?? (() => {});
  const secrets = config.secrets ?? [];
  const submitted: SubmittedTimelineEvent[] = [];
  const errors: Error[] = [];
  // Ardışıklığı garantileyen söz zinciri — consensus sırası gönderim sırasını izler.
  let chain: Promise<void> = Promise.resolve();

  return {
    topicId: config.topicId,
    hashscanUrl: `${HASHSCAN}/topic/${config.topicId}`,

    record(event: TimelineEvent): void {
      // Şema + sızıntı denetimi SENKRON: hatalı olay ağa hiç çıkmasın.
      const parsed = TimelineEventSchema.parse(event);
      assertNoPlaintext(parsed, secrets);

      chain = chain.then(async () => {
        try {
          const receipt = await (
            await new TopicMessageSubmitTransaction()
              .setTopicId(config.topicId)
              .setMessage(JSON.stringify(parsed))
              .execute(config.client)
          ).getReceipt(config.client);
          const sequenceNumber = Number(receipt.topicSequenceNumber?.toString() ?? '0');
          submitted.push({ event: parsed, sequenceNumber });
          log(`[hcs] ${parsed.stage} → #${sequenceNumber}`);
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },

    async flush(): Promise<SubmittedTimelineEvent[]> {
      await chain;
      if (errors.length) {
        throw new Error(`HCS zaman çizelgesi ${errors.length} olayı yazamadı: ${errors[0]?.message}`);
      }
      return [...submitted];
    },

    close(): void {
      config.client.close();
    },
  };
}

/**
 * Bir işin zaman çizelgesini mirror node'dan oku.
 *
 * Mirror node indekslemesi anlık değil; `expect` kadar olay görene kadar yoklar.
 */
export async function readTimeline(
  topicId: string,
  intentHash: string,
  { expect = 1, tries = 20, delayMs = 1500 } = {},
): Promise<RecordedTimelineEvent[]> {
  const wanted = intentHash.toLowerCase();

  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(`${MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages?limit=200&order=desc`);
    if (res.ok) {
      const body = (await res.json()) as {
        messages?: Array<{ consensus_timestamp?: string; message?: string; sequence_number?: number }>;
      };
      const found: RecordedTimelineEvent[] = [];
      for (const m of body.messages ?? []) {
        if (!m.message) continue;
        let parsed: TimelineEvent;
        try {
          parsed = TimelineEventSchema.parse(JSON.parse(Buffer.from(m.message, 'base64').toString('utf8')));
        } catch {
          continue; // bu topic'te başka mesajlar da olabilir (ör. P0-E test mesajı)
        }
        if (parsed.intentHash.toLowerCase() !== wanted) continue;
        found.push({
          event: parsed,
          sequenceNumber: m.sequence_number ?? 0,
          consensusTimestamp: m.consensus_timestamp ?? '',
        });
      }
      if (found.length >= expect) {
        return found.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      }
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return [];
}

export { MIRROR_NODE_URL, HASHSCAN };
