// hcs-timeline.ts — writes the job lifecycle to an HCS topic (BUILD-PLAN P4-D).
//
// ZERO SOLIDITY: HCS is a native Hedera service, not something on top of the EVM. No
// contract, no deploy, no ABI — only `TopicMessageSubmitTransaction` and mirror node REST reads.
//
// This is the roadmap's Hedera differentiator: the reference x402-hedera-example has no HCS
// attestation at all; and even if it did, it would attest a PAYMENT. We attest THE WHOLE JOB,
// from the 402 all the way to settlement.
//
// ORDERING GUARANTEE + LATENCY: consensus order follows submission order, so messages must be
// submitted SEQUENTIALLY. But to avoid stalling the demo by 5×~2 s, `record()` appends the
// submission to a promise chain and returns IMMEDIATELY; `flush()` waits for all of them.
// That keeps the ordering while leaving the critical path unblocked.

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
  /** The operator client — the key stays in the signer module (createHederaOperatorClient). */
  client: Client;
  topicId: string;
  /**
   * Plaintexts that must never reach the topic (brief, data, output). Every event is scanned
   * against these BEFORE submission — an accidental leak never reaches the network.
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
  /** Queue the event and return IMMEDIATELY. Submission happens in the background, in order. */
  record(event: TimelineEvent): void;
  /** Complete all pending submissions. */
  flush(): Promise<SubmittedTimelineEvent[]>;
  close(): void;
}

export function createHcsTimeline(config: HcsTimelineConfig): HcsTimeline {
  const log = config.log ?? (() => {});
  const secrets = config.secrets ?? [];
  const submitted: SubmittedTimelineEvent[] = [];
  const errors: Error[] = [];
  // The promise chain that guarantees sequencing — consensus order follows submission order.
  let chain: Promise<void> = Promise.resolve();

  return {
    topicId: config.topicId,
    hashscanUrl: `${HASHSCAN}/topic/${config.topicId}`,

    record(event: TimelineEvent): void {
      // Schema + leak checks are SYNCHRONOUS: a malformed event must never reach the network.
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
        throw new Error(`the HCS timeline failed to write ${errors.length} event(s): ${errors[0]?.message}`);
      }
      return [...submitted];
    },

    close(): void {
      config.client.close();
    },
  };
}

/**
 * Read a job's timeline from the mirror node.
 *
 * Mirror node indexing is not instantaneous; it polls until it sees `expect` events.
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
          continue; // this topic may carry other messages too (e.g. the P0-E test message)
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
