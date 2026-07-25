// compute-fixture.ts — replays recorded 0G responses WITHOUT TOUCHING THE NETWORK.
//
// BUILD-PLAN P0-D/4: every real 0G call is written to a fixture; in `REPLAY_0G=1` mode the
// request is served from that fixture. UI, contract and subgraph work is done with this —
// we have a budget of ~12,400 calls, but there is no sense in burning money on every
// `pnpm gate:*` run.
//
// HONESTY: the replay backend carries the `provider: 'fixture-replay'` label and that label
// reaches the UI (describeCompute → "not a live call"). We do not present a recorded
// response as if it were live.
//
// BUT the replay VERIFIES, it does not merely LABEL: the recorded signature is recovered
// again on every replay and compared against the recorded signer. If the fixture is
// tampered with, `ogVerified` becomes false. So "it comes from a recording" does not mean
// "unchecked".

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyMessage } from 'ethers';

import type { ComputeBackend, ComputeRequest, ComputeResult } from './compute.js';

/** The shape of a 0G run stored on disk (produced by scripts/og-spike.ts). */
export interface RecordedRun {
  request: { endpoint: string; model: string; prompt: string };
  rawResponseText: string;
  output: string;
  latencyMs: number;
  chatID: string;
  signature: { text: string; signature: string };
  verification: { expectedSigner: string; responseSha256?: string };
  /** Optional: the key of the request that produced this run. Without it the file is a "generic" record. */
  requestKey?: string;
}

/**
 * The deterministic key of a compute request.
 *
 * Field names go into the hash too, so that {brief:"a",data:"b"} and {brief:"b",data:"a"}
 * do not produce the same key.
 */
export function computeRequestKey(request: ComputeRequest): string {
  const canonical = JSON.stringify({
    brief: request.brief,
    data: request.data,
    constraints: request.constraints,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Write a real 0G run to disk — later replays use it. */
export function recordRun(dir: string, run: RecordedRun): string {
  mkdirSync(dir, { recursive: true });
  const name = run.requestKey ? `run-${run.requestKey.slice(0, 16)}.json` : 'run-1.json';
  const path = resolve(dir, name);
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return path;
}

export interface FixtureBackendOptions {
  /** The fixtures/og directory. */
  dir: string;
  /**
   * What to do when the request key does not match?
   *   'fallback' → replay any available record (convenient during development)
   *   'strict'   → throw (use this in gates)
   */
  onMiss?: 'fallback' | 'strict';
}

/** Read every record on disk. */
function loadRuns(dir: string): Map<string, RecordedRun> {
  const runs = new Map<string, RecordedRun>();
  if (!existsSync(dir)) return runs;
  for (const file of readdirSync(dir)) {
    if (!file.startsWith('run-') || !file.endsWith('.json')) continue;
    const run = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as RecordedRun;
    runs.set(run.requestKey ?? file, run);
  }
  return runs;
}

export function createFixtureComputeBackend(options: FixtureBackendOptions): ComputeBackend {
  const onMiss = options.onMiss ?? 'fallback';
  const runs = loadRuns(options.dir);
  if (runs.size === 0) {
    throw new Error(
      `no recorded 0G run under ${options.dir} — run this first: npx tsx scripts/og-spike.ts`,
    );
  }

  return {
    provider: 'fixture-replay',
    async run(request: ComputeRequest): Promise<ComputeResult> {
      const started = Date.now();
      const key = computeRequestKey(request);

      let run = runs.get(key);
      if (!run) {
        if (onMiss === 'strict') {
          throw new Error(`no fixture: request key ${key.slice(0, 16)}… (strict mode)`);
        }
        run = runs.values().next().value as RecordedRun;
      }

      // We re-verify the recorded signature on EVERY replay — if the fixture is tampered
      // with, ogVerified becomes false. NO NETWORK ACCESS: verifyMessage is pure computation.
      let ogSigner: string | undefined;
      let ogVerified = false;
      try {
        ogSigner = verifyMessage(run.signature.text, run.signature.signature);
        ogVerified = ogSigner.toLowerCase() === run.verification.expectedSigner.toLowerCase();
      } catch {
        ogVerified = false;
      }

      return {
        output: run.output,
        ogSig: run.signature.signature,
        ogSigner,
        ogVerified,
        provider: 'fixture-replay',
        chatId: run.chatID,
        // We carry the REAL latency from the recording, not the replay's own speed.
        // Otherwise the P0-G budget would look better than it is.
        latencyMs: run.latencyMs,
        replayedAt: Date.now() - started,
      } as ComputeResult & { replayedAt: number };
    },
  };
}
