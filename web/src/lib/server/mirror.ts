// Hedera mirror-node access for the Job timeline panel.
//
// The timestamps shown are HEDERA'S, not ours: `consensus_timestamp` is what the network agreed,
// read back from the public mirror node. We do not record our own clock and label it consensus —
// a timeline whose times come from the machine that wrote it proves nothing.
//
// What is on the topic is COMMITMENTS ONLY (hashes, stage names, flags). The brief, the data and
// the output never go near it; see @ca/payment's hcs-timeline, which scans outgoing messages for
// the secrets before they reach the network.

import "server-only";
import "./env";

export interface TimelineMessage {
  sequenceNumber: number;
  /** Hedera's consensus timestamp, seconds.nanos — the network's clock, not ours. */
  consensusTimestamp: string;
  /** ISO form of the above, for display. */
  consensusIso: string;
  /** The decoded commitment. Shape varies by stage; rendered generically. */
  payload: Record<string, unknown>;
  /** Undecodable payloads are surfaced, not dropped. */
  raw?: string;
}

export interface TimelineSnapshot {
  topicId: string;
  hashscanUrl: string;
  mirrorQueryUrl: string;
  messages: TimelineMessage[];
}

function mirrorBase(): string {
  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase();
  return network === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : `https://${network}.mirrornode.hedera.com`;
}

/** seconds.nanos → ISO 8601, keeping millisecond precision. */
function toIso(consensusTimestamp: string): string {
  const [seconds = "0", nanos = "0"] = consensusTimestamp.split(".");
  const ms = Number(seconds) * 1000 + Math.floor(Number(nanos.padEnd(9, "0")) / 1e6);
  return new Date(ms).toISOString();
}

interface RawMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string;
}

export async function fetchTimeline(intentHash?: string, limit = 50): Promise<TimelineSnapshot> {
  const topicId = process.env.HEDERA_TOPIC_ID;
  if (!topicId) throw new Error("HEDERA_TOPIC_ID is not set — there is no timeline to read");

  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase();
  const mirrorQueryUrl =
    `${mirrorBase()}/api/v1/topics/${topicId}/messages?limit=${limit}&order=desc`;

  const res = await fetch(mirrorQueryUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`mirror node HTTP ${res.status}`);
  const body = (await res.json()) as { messages?: RawMessage[] };

  const messages: TimelineMessage[] = (body.messages ?? []).map((m) => {
    const decoded = Buffer.from(m.message, "base64").toString("utf8");
    let payload: Record<string, unknown>;
    let raw: string | undefined;
    try {
      payload = JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      payload = {};
      raw = decoded;
    }
    return {
      sequenceNumber: m.sequence_number,
      consensusTimestamp: m.consensus_timestamp,
      consensusIso: toIso(m.consensus_timestamp),
      payload,
      raw,
    };
  });

  // Filtering happens here rather than in the query because the mirror node cannot search
  // inside a message body. One job's timeline is a handful of messages out of the last N.
  //
  // With no job specified, show the MOST RECENT job rather than the last 50 messages. The topic
  // accumulates every run ever made, so an unfiltered list interleaves a dozen jobs and reads as
  // noise — burying the one thing this panel exists to show: that a SINGLE job's stages are
  // ordered and timestamped by consensus.
  // NB: `messages` is still newest-first here (the query asked for order=desc), so the first
  // intentHash found IS the most recent job. It is reversed into reading order further down —
  // doing that lookup after the reverse would silently select the OLDEST job in the window,
  // whose earlier stages have usually already fallen outside it.
  const target =
    intentHash?.toLowerCase() ??
    messages.map((m) => String(m.payload.intentHash ?? "").toLowerCase()).find(Boolean);

  const filtered = target
    ? messages.filter((m) => String(m.payload.intentHash ?? "").toLowerCase() === target)
    : messages;

  return {
    topicId,
    hashscanUrl: `https://hashscan.io/${network}/topic/${topicId}`,
    mirrorQueryUrl,
    // Oldest first: a timeline reads forwards. The query asks for desc only to get the LATEST
    // messages rather than the first ever written.
    messages: filtered.reverse(),
  };
}
