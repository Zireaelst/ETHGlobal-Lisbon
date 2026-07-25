// POST /api/run — execute one real job, streaming progress.
// GET  /api/run?mode=… — the last REAL run of that mode, for when the runner is off.
//
// Server-Sent Events rather than a single JSON response, because an honest run takes tens of
// seconds (0G inference, two agent decisions, a block confirmation) and a judge staring at a
// spinner learns nothing. The events are the flow's own log lines, so the dashboard narrates
// exactly what the terminal would.

import { NextResponse } from "next/server";
import {
  RunnerBusyError,
  RunnerDisabledError,
  executeRun,
  readRecordedRun,
  runnerEnabled,
  type FraudMode,
  type PaymentRail,
} from "@/lib/server/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A live run outlives the default serverless budget: it is meant for a long-lived Node host.
export const maxDuration = 300;

const MODES: FraudMode[] = ["none", "substitute", "tamper", "forge", "selfintent"];
const RAILS: PaymentRail[] = ["hedera", "base", "none"];

function parseMode(value: string | null): FraudMode {
  if (value && (MODES as string[]).includes(value)) return value as FraudMode;
  return "none";
}

/** The recorded run — real tx hashes, real timestamps, explicitly labelled as a recording. */
export async function GET(request: Request) {
  const mode = parseMode(new URL(request.url).searchParams.get("mode"));
  const recorded = readRecordedRun(mode);
  if (!recorded) {
    return NextResponse.json(
      { error: `no recorded "${mode}" run has been saved yet`, runnerEnabled: runnerEnabled() },
      { status: 404 },
    );
  }
  return NextResponse.json({ ...recorded, live: false, runnerEnabled: runnerEnabled() });
}

export async function POST(request: Request) {
  let body: { mode?: string; rail?: string };
  try {
    body = (await request.json()) as { mode?: string; rail?: string };
  } catch {
    body = {};
  }
  const mode = parseMode(body.mode ?? null);
  const rail = (RAILS as string[]).includes(body.rail ?? "") ? (body.rail as PaymentRail) : "none";

  if (!runnerEnabled()) {
    // 503 with a machine-readable reason, so the UI can switch to the recorded run and say why
    // rather than showing a generic failure.
    return NextResponse.json(
      { error: new RunnerDisabledError().message, reason: "runner-disabled", runnerEnabled: false },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("start", { mode, rail, at: new Date().toISOString() });
      try {
        const report = await executeRun(mode, rail, {
          onLog: (line) => send("log", { line }),
        });
        send("report", { report, live: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const reason = error instanceof RunnerBusyError ? "runner-busy" : "run-failed";
        // A failed run is reported as a failed run. The recorded run is offered as an
        // alternative by the CLIENT, never silently substituted here — the two must never be
        // indistinguishable to whoever is watching.
        send("error", { message, reason });
      } finally {
        send("done", {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
