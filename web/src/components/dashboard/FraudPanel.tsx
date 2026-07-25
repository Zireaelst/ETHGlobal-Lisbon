"use client";

import { useCallback, useRef, useState } from "react";
import { Panel, Chip, Field, ProofLink } from "./Panel";
import { Hash } from "./Hash";
import { type FraudMode, type RunView } from "@/lib/run-types";

/**
 * THE panel. Four of the five show state; this one makes something happen.
 *
 * It runs a real job against a real chain and shows the contract throwing it out. Everything
 * here is arranged around one claim being checkable live: that we prove not merely that a TEE
 * ran, but that the RIGHT JOB ran.
 *
 * Two honesty rules are load-bearing in this component:
 *   - A failed run is never quietly replaced by the recording. If the live runner is off or the
 *     run breaks, the panel says so and offers the recording as an explicit, labelled choice.
 *   - "Recorded" is stated wherever a recorded run is displayed. A recording of a real run is
 *     honest; a recording presented as live is not, and the two must never look the same.
 */

const MODES: Array<{ mode: FraudMode; label: string; blurb: string; expect: string }> = [
  {
    mode: "none",
    label: "Honest run",
    blurb: "Bob forwards the job untouched.",
    expect: "JobVerified",
  },
  {
    mode: "substitute",
    label: "Answer a different job",
    blurb:
      "Bob cannot decrypt Alice's brief — the key is in the enclave — so he encrypts a job he invented and sends that instead.",
    expect: "MatchFalse",
  },
  {
    mode: "forge",
    label: "Forge the signature",
    blurb: "Bob signs the body with a key that never was inside the enclave.",
    expect: "BadEnclaveSig",
  },
  {
    mode: "selfintent",
    label: "Invent the order",
    blurb: "Bob fabricates an intent Alice never signed.",
    expect: "BadClientSig",
  },
];

export function FraudPanel({
  run,
  onRun,
  runnerEnabled,
}: {
  run: RunView | null;
  onRun: (view: RunView | null) => void;
  runnerEnabled: boolean;
}) {
  const [mode, setMode] = useState<FraudMode>("substitute");
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const append = useCallback((line: string) => {
    setLogs((prev) => [...prev, line]);
    // Follow the tail: during a live run the interesting line is always the newest one.
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }, []);

  const showRecorded = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/run?mode=${mode}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `no recorded "${mode}" run is available`);
      return;
    }
    const body = (await res.json()) as RunView;
    onRun(body);
    append(`[recorded] showing the run of ${body.recordedAt ?? "an earlier session"} — not a live call`);
  }, [mode, onRun, append]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setLogs([]);
    onRun(null);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, rail: "none" }),
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `the runner refused the request (HTTP ${res.status})`);
        return;
      }

      // Hand-rolled SSE reader: the payload is small and one dependency is not worth it.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (!event || !data) continue;
          const parsed = JSON.parse(data) as Record<string, unknown>;

          if (event === "log") append(String(parsed.line));
          if (event === "report") onRun({ report: parsed.report as RunView["report"], live: true });
          if (event === "error") {
            setError(String(parsed.message));
            append(`[error] ${String(parsed.message)}`);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [mode, onRun, append]);

  const selected = MODES.find((m) => m.mode === mode) ?? MODES[1]!;
  const report = run?.report;
  const rejected = report ? !report.verified : false;

  return (
    <Panel
      eyebrow="Live · the thesis"
      title="Make Bob cheat"
      tint="cool"
      subtitle={
        <>
          Payment, execution and reputation are each solved for agents. Nothing connects them. This
          button runs a real job where Bob answers something other than what Alice ordered — and the
          contract throws it out on chain, so the payment never settles.
        </>
      }
      actions={
        run ? (
          run.live ? (
            <Chip tone="cool">live run</Chip>
          ) : (
            <Chip tone="neutral" title={run.recordedAt}>
              recorded run
            </Chip>
          )
        ) : null
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div>
          <div className="flex flex-col gap-2">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                onClick={() => setMode(m.mode)}
                disabled={busy}
                className={`rounded-md border px-3.5 py-3 text-left transition disabled:opacity-50 ${
                  m.mode === mode
                    ? "border-cool/60 bg-cool/[0.07]"
                    : "border-border hover:border-cool/40"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-body text-sm text-foreground">{m.label}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {m.expect}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <p className="mt-3 font-body text-xs font-light leading-relaxed text-muted-foreground">
            {selected.blurb}
          </p>

          <button
            type="button"
            onClick={start}
            disabled={busy || !runnerEnabled}
            className="mt-4 w-full rounded-md border border-cool/60 bg-cool/[0.1] px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-foreground transition hover:bg-cool/[0.16] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "running…" : runnerEnabled ? "Run it for real" : "Live runner is off here"}
          </button>

          {!runnerEnabled ? (
            <p className="mt-2 font-body text-xs font-light leading-relaxed text-muted-foreground">
              This deployment holds no keys, so it cannot spend gas.{" "}
              <button type="button" onClick={showRecorded} className="text-cool underline underline-offset-4">
                Show the last real run
              </button>{" "}
              — a genuine past run with a working Basescan link, clearly labelled as a recording.
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-md border border-alert/40 px-3 py-2 font-body text-xs font-light leading-relaxed text-alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <div
            ref={logRef}
            className="h-56 overflow-y-auto rounded-md border border-border bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {logs.length === 0 ? (
              <span className="opacity-60">
                The agents&apos; own log lines appear here — the same ones `pnpm demo:base` prints.
              </span>
            ) : (
              logs.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))
            )}
          </div>

          {report ? (
            <div className="mt-4 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                {rejected ? (
                  <Chip tone="alert">the chain rejected it · {report.codeName}</Chip>
                ) : (
                  <Chip tone="good">JobVerified</Chip>
                )}
                <Chip tone={report.ogVerified ? "cool" : "neutral"}>
                  {report.computeProvider}
                  {report.ogVerified ? " · TEE sig verified" : ""}
                </Chip>
                <Chip tone="neutral">{report.totalMs} ms</Chip>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Alice signed">
                  {/* A function argument, never an on-chain record of its own. */}
                  <Hash
                    value={report.signedIntentHash}
                    href={report.basescanUrl ? `${report.basescanUrl}#eventlog` : null}
                    goesTo="the event log of the transaction that carried it"
                    why="No transaction was sent, so this commitment has no on-chain record yet."
                  />
                </Field>
                <Field label="The enclave&apos;s body carried">
                  <Hash
                    value={report.bodyIntentHash}
                    href={report.basescanUrl ? `${report.basescanUrl}#eventlog` : null}
                    goesTo="the event log — under fraud this is the commitment Bob fabricated"
                    why="No transaction was sent, so this commitment has no on-chain record yet."
                  />
                </Field>
                <Field label="match">
                  <span className={report.match ? "text-warm" : "text-alert"}>{String(report.match)}</span>
                </Field>
                <Field label="Alice&apos;s signature checked out">
                  <span className={report.clientSigOk ? "text-warm" : "text-alert"}>
                    {String(report.clientSigOk)}
                  </span>
                </Field>
              </div>

              {rejected ? (
                <p className="mt-4 font-body text-sm font-light leading-relaxed text-foreground">
                  The enclave reported <span className="font-mono text-alert">match: false</span> rather than
                  covering for Bob, the contract refused the job, and no settlement was triggered —{" "}
                  <span className="text-foreground">Bob did the work and gets nothing.</span>
                </p>
              ) : null}

              {report.basescanUrl ? (
                <p className="mt-3">
                  <ProofLink href={report.basescanUrl}>
                    {rejected ? "JobRejected" : "JobVerified"} on Base Sepolia ↗
                  </ProofLink>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
