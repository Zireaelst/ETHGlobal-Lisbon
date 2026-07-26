"use client";

import { useCallback, useRef, useState } from "react";
import { Panel, Chip, Field, ProofLink } from "./Panel";
import { Hash } from "./Hash";
import { type FraudMode, type PaymentRail, type RunView } from "@/lib/run-types";

/**
 * THE panel. Five of the six show state; this one makes something happen.
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
    // The other half of the binding's only claim. Without it the panel demonstrated task
    // substitution and left "and input tampering" as an assertion nobody could watch fail.
    mode: "tamper",
    label: "Edit the data",
    blurb:
      "Bob keeps Alice's brief and alters the figures underneath it. The commitment covers the data too, so the recomputed hash stops matching — the same MatchFalse the contract returns for substitution, reached by touching one number instead of the whole job.",
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

/**
 * The rail is the operator's choice per run, not a deployment setting, because the two demos are
 * different demos. Picking one in `.env` would mean the other claim can never be shown live.
 */
const RAILS: Array<{ rail: PaymentRail; label: string; buys: string }> = [
  {
    rail: "hedera",
    label: "Hedera · x402",
    buys:
      "Autonomy and a consensus-timestamped trail: the agent quotes, is authorised and settles through the blocky402 facilitator, and every stage lands on HCS. The recipient is a plain account — this run buys no privacy.",
  },
  {
    rail: "base",
    label: "Base · stealth",
    buys:
      "Recipient privacy: payment goes to a fresh ERC-5564 stealth address derived per job, so the payout does not name Bob and two jobs of his cannot be linked by their payouts.",
  },
];

/**
 * Which network carried the money, in one word.
 *
 * The rail string comes from whichever backend produced the receipt, so it arrives as
 * `hedera-x402`, `base-stealth`, or the bare rail name from a run that settled nothing. The
 * explorer URL is only a last resort, for recordings made before the rail was carried on the
 * unsettled path — and when even that is missing the answer is "—", not a guess.
 */
function railName(rail: string | undefined, explorerUrl: string | undefined): string {
  const s = `${rail ?? ""} ${explorerUrl ?? ""}`.toLowerCase();
  if (s.includes("hedera") || s.includes("hashscan")) return "Hedera";
  if (s.includes("base") || s.includes("basescan")) return "Base";
  return "—";
}

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
  const [rail, setRail] = useState<PaymentRail>("hedera");
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
        // A real rail, never "none". With no rail the run issues no 402, authorises nothing and
        // settles nothing — so the one claim the payment layer exists to make ("money moves only
        // after JobVerified") could not be demonstrated by the button that demonstrates everything
        // else. On a fraud run this is exactly what stays unspent, and the timeline shows the
        // missing SETTLED stage.
        body: JSON.stringify({ mode, rail }),
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
  }, [mode, rail, onRun, append]);

  const selected = MODES.find((m) => m.mode === mode) ?? MODES[1]!;
  const selectedRail = RAILS.find((r) => r.rail === rail) ?? RAILS[0]!;
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

          <div className="mt-5 border-t border-border/60 pt-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Payment rail
            </p>
            <div className="mt-2 flex gap-2">
              {RAILS.map((r) => (
                <button
                  key={r.rail}
                  type="button"
                  onClick={() => setRail(r.rail)}
                  disabled={busy}
                  aria-pressed={r.rail === rail}
                  className={`flex-1 rounded-md border px-3 py-2 font-mono text-[11px] transition disabled:opacity-50 ${
                    r.rail === rail ? "border-warm/60 bg-warm/[0.08] text-foreground" : "border-border text-muted-foreground hover:border-warm/40"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="mt-2 font-body text-xs font-light leading-relaxed text-muted-foreground">
              {selectedRail.buys}
            </p>
          </div>

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

          {/* The fallback belongs to BOTH failure modes. This component's own rule is that a
              broken run offers the recording as a labelled choice, but the offer used to live
              only in the runner-is-off branch — so the case it was written for, keys present
              and the run failing anyway (an empty faucet, a dead RPC), left the reader with an
              error and no way forward. */}
          {error ? (
            <div className="mt-3 rounded-md border border-alert/40 px-3 py-2">
              <p className="font-body text-xs font-light leading-relaxed text-alert">{error}</p>
              {runnerEnabled ? (
                <p className="mt-2 font-body text-xs font-light leading-relaxed text-muted-foreground">
                  <button
                    type="button"
                    onClick={showRecorded}
                    className="text-cool underline underline-offset-4"
                  >
                    Show the last real run
                  </button>{" "}
                  instead — a genuine past run of this same mode, clearly labelled as a recording.
                </p>
              ) : null}
            </div>
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
                {/* From the report's own `rail`, not from the settlement URL. Sniffing the URL
                    for "hashscan" was fine for a settled run and wrong for every other one: a
                    rejected job has no settlement link, so the fallback branch labelled every
                    Hedera fraud run "Base". The rail is a fact about the run, not about whether
                    it produced a link. */}
                {report.payment ? (
                  <Chip tone={report.payment.settled ? "good" : "alert"}>
                    {railName(report.payment.rail, report.payment.explorerUrl)}
                    {report.payment.settled ? " · settled" : " · not settled"}
                  </Chip>
                ) : null}
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
                  {/* Said once, where the confusion happens: the verdict is on Base on EVERY run,
                      whichever rail carries the money, and it is what the money waits for. */}
                  <span className="ml-2 font-body text-xs font-light text-muted-foreground">
                    the verdict is always on Base — the rail only decides where the money moves,
                    and only after this
                  </span>
                </p>
              ) : null}

              {/* WHO GOT PAID — the only place the privacy difference between the two rails is
                  visible. Both addresses are shown and the comparison is left explicit, because
                  "these two differ" is something the reader can check and "private: true" is
                  something they would have to take our word for. */}
              {report.payment?.settled && report.payment.paidTo ? (
                <div className="mt-4 rounded-md border border-border/60 p-3">
                  <Field label="Paid to">
                    <Hash value={report.payment.paidTo} why="The address the money actually reached." />
                  </Field>
                  <div className="mt-2">
                    <Field label="The agent is registered as">
                      <Hash
                        value={report.payment.agentIdentity ?? "—"}
                        why="Bob's public payout identity — what anyone watching already knows him by."
                      />
                    </Field>
                  </div>
                  <p className="mt-2.5 font-body text-xs font-light leading-relaxed">
                    {report.payment.paidTo.toLowerCase() === report.payment.agentIdentity?.toLowerCase() ? (
                      <span className="text-muted-foreground">
                        Same account, and it is the one published in Bob&apos;s agent card. This rail buys
                        autonomy and a timestamped trail — <span className="text-foreground">not privacy</span>.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Different — the payout does not name Bob. A fresh ERC-5564 address is derived per
                        job, so run it twice and this line changes while his registered address does not.{" "}
                        <span className="text-foreground">
                          On this testnet one client and one agent still make timing correlation possible;
                          what is hidden is the payment record, not the whole system.
                        </span>
                      </span>
                    )}
                  </p>
                </div>
              ) : null}

              {/* The settlement, or the stated reason there isn't one. A fraud run's most
                  load-bearing evidence is the payment that never happened, so it is named
                  rather than left as an absence the reader has to notice. */}
              {report.payment?.settled && report.payment.explorerUrl ? (
                <p className="mt-2">
                  {/* Named, because every run also carries a Basescan link for the VERDICT and the
                      two are easy to confuse. On the Hedera rail the Base link is not the payment
                      at all — it is the JobVerified that had to happen before the payment could. */}
                  <ProofLink href={report.payment.explorerUrl}>
                    payment settled on {railName(report.payment.rail, report.payment.explorerUrl)} ↗
                  </ProofLink>
                </p>
              ) : report.payment && !report.payment.settled ? (
                <p className="mt-2 font-mono text-[11px] text-alert">
                  payment not settled — {report.payment.skippedReason ?? "the job was not verified"}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
