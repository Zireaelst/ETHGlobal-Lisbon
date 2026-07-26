// The live demo runner — the only server code in the dashboard that spends money.
//
// Everything else in this app reads public networks. This calls @ca/demo's runDemo(), which
// signs with Alice's key, boots Bob on the port his ERC-8004 record advertises, may spend 0G
// faucet credit, and writes a transaction to Base Sepolia. Three consequences follow, and each
// is handled below rather than left to luck:
//
//   1. It cannot be concurrent. Bob binds a fixed port and the flow assumes one job at a time,
//      so a second click while a run is in flight must be refused, not queued into a port clash.
//   2. It must be opt-in. A deployment without keys should say "the live runner is off here"
//      and serve the last real run — never crash, and never fake one.
//   3. Its result is worth keeping. A recorded run carries real tx hashes and real consensus
//      timestamps; replaying it is honest as long as it is LABELLED as a recording, which is
//      what `recordedAt` is for.

import "server-only";
import "./env";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DemoReport } from "@ca/demo";
import { repoRoot } from "@ca/shared";

export type FraudMode = "none" | "substitute" | "tamper" | "forge" | "selfintent";
export type PaymentRail = "hedera" | "base" | "none";

/** A stored run: the report plus when it actually happened. */
export interface RecordedRun {
  report: DemoReport;
  recordedAt: string;
}

/**
 * Is the live runner allowed to run here?
 *
 * Explicit opt-in rather than "do we happen to have a key": a public deployment that acquired
 * a key by accident should still not be spending it because someone clicked a button.
 */
export function runnerEnabled(): boolean {
  return process.env.DEMO_RUNNER_ENABLED === "1";
}

let cachedRunsDir: string | null = null;

/**
 * Where the recorded runs live.
 *
 * `fixtures/runs/` sits at the repo root, one level above this app, and the three places this
 * code runs disagree about the working directory: `next dev` starts in web/, the CLI starts at
 * the repo root, and a deployed serverless bundle contains no `pnpm-workspace.yaml` at all — so
 * @ca/shared's `repoRoot()`, which walks up looking for exactly that marker, silently falls
 * back to cwd there and every recording 404s. Since the marker does not survive the bundle,
 * walk up looking for the directory we actually want instead.
 *
 * The fallback still goes through `repoRoot()`: a fresh checkout that has recorded nothing yet
 * has no `fixtures/runs` to find, and the first run needs somewhere to write it.
 */
function runsDir(): string {
  if (cachedRunsDir) return cachedRunsDir;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, "fixtures/runs");
    if (existsSync(candidate)) return (cachedRunsDir = candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return (cachedRunsDir = resolve(repoRoot(), "fixtures/runs"));
}

function runPath(mode: FraudMode): string {
  // Tracked in git on purpose. A deployment with no filesystem persistence still needs a real
  // run to show, and the only way that is honest is if the recording ships with the code.
  // `next.config.ts` traces these files into the deployed bundle for the same reason.
  return resolve(runsDir(), `${mode}.json`);
}

export function readRecordedRun(mode: FraudMode): RecordedRun | null {
  try {
    return JSON.parse(readFileSync(runPath(mode), "utf8")) as RecordedRun;
  } catch {
    return null;
  }
}

function saveRecordedRun(mode: FraudMode, report: DemoReport): void {
  try {
    const path = runPath(mode);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ report, recordedAt: new Date().toISOString() }, null, 2)}\n`);
  } catch {
    // A recording that fails to save must not fail the run the judge is watching.
  }
}

let inFlight: FraudMode | null = null;

export class RunnerBusyError extends Error {
  constructor(mode: FraudMode) {
    super(`a "${mode}" run is already in flight — Bob binds one port and serves one job at a time`);
    this.name = "RunnerBusyError";
  }
}

export class RunnerDisabledError extends Error {
  constructor() {
    super("the live runner is disabled here (DEMO_RUNNER_ENABLED is not 1)");
    this.name = "RunnerDisabledError";
  }
}

export interface RunEvents {
  onLog: (line: string) => void;
}

/**
 * Execute one real run. Streams the flow's own log lines out as they happen — the same lines
 * `pnpm demo:base` prints, so what the dashboard shows and what the terminal shows cannot drift.
 */
export async function executeRun(
  mode: FraudMode,
  rail: PaymentRail,
  events: RunEvents,
): Promise<DemoReport> {
  if (!runnerEnabled()) throw new RunnerDisabledError();
  if (inFlight) throw new RunnerBusyError(inFlight);
  inFlight = mode;

  try {
    // Imported lazily so that merely rendering the dashboard does not pull ethers, the Hedera
    // SDK and Bob's server into the process on a deployment where the runner is switched off.
    const { runDemo, closeBob } = await import("@ca/demo");
    try {
      const report = await runDemo({
        fraudMode: mode,
        paymentRail: rail,
        log: events.onLog,
      });
      saveRecordedRun(mode, report);
      return report;
    } finally {
      await closeBob();
    }
  } finally {
    inFlight = null;
  }
}
