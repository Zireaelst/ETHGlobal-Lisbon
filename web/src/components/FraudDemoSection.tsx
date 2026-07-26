"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

const RUNS = {
  honest: {
    label: "Honest run",
    caption: "Bob answers the job Alice ordered.",
    recomputed: "0x9f3a…c02e",
    match: true,
    verdict: "JobVerified",
    code: "emit JobVerified(intentHash, outputHash)",
    outcome: "Settlement releases.",
  },
  fraud: {
    label: "Substituted job",
    caption: "One flag makes Bob answer a different brief.",
    recomputed: "0x4e11…8ba7",
    match: false,
    verdict: "Rejected · MatchFalse",
    code: "emit JobRejected(intentHash, code 5) ✗",
    outcome: "No JobVerified, no settlement. The money never moves.",
  },
} as const;

type RunKey = keyof typeof RUNS;

/**
 * The fraud path is the whole argument for intent-binding, so it gets a
 * control the reader can actually flip rather than a "coming soon" card.
 * The numbers are illustrative — the same check runs on-chain in the demo
 * dApp, and the copy says so instead of implying this panel is live.
 */
export default function FraudDemoSection() {
  const [run, setRun] = useState<RunKey>("honest");
  const active = RUNS[run];
  const rejected = !active.match;
  const accent = rejected ? "var(--chap-alert)" : "var(--chap-cool)";

  return (
    <section id="fraud" className="section px-8 py-32 sm:px-16 md:py-40">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
        <Reveal>
          <SectionEyebrow tint="warm">The fraud path</SectionEyebrow>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="font-display text-4xl font-light tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Substitute the job. Watch it bounce.
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="max-w-lg font-body text-base font-extralight leading-relaxed text-muted-foreground">
            The binding catches task substitution and input tampering. Flip
            the switch and the contract stops agreeing.
          </p>
        </Reveal>
      </div>

      <Reveal delay={220} className="mx-auto mt-16 max-w-xl">
        <div
          role="group"
          aria-label="Choose a run"
          className="relative mx-auto flex w-full max-w-sm rounded-full border border-border p-1"
        >
          {(Object.keys(RUNS) as RunKey[]).map((key) => {
            const selected = run === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setRun(key)}
                aria-pressed={selected}
                className="relative flex-1 rounded-full px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-300"
                style={{ color: selected ? "var(--ink)" : "var(--ink-soft)" }}
              >
                {selected && (
                  <motion.span
                    layoutId="fraud-toggle"
                    className="absolute inset-0 rounded-full bg-fill"
                    style={{ boxShadow: `inset 0 0 0 1px ${accent}` }}
                    transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  />
                )}
                <span className="relative">{RUNS[key].label}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-5 text-center font-body text-[13px] font-extralight text-muted-foreground">
          {active.caption}
        </p>

        <motion.div
          className="relative mt-10 overflow-hidden rounded-3xl border border-border bg-fill p-8 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-10"
          animate={{ boxShadow: `inset 0 0 0 1px ${accent}, 0 0 60px -26px ${accent}` }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <div className="flex flex-col gap-3.5 font-mono text-[12.5px]">
            <HashRow label="Alice signed" value="0x9f3a…c02e" />
            <HashRow
              label="Bob recomputed"
              value={active.recomputed}
              tone={rejected ? "alert" : "ok"}
              swapKey={run}
            />
            <HashRow
              label="match"
              value={String(active.match)}
              tone={rejected ? "alert" : "ok"}
              swapKey={run}
            />
          </div>

          <div className="mt-8 border-t border-border pt-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={run}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex flex-col items-center gap-3 text-center"
              >
                {rejected ? (
                  <ShieldAlert className="h-7 w-7 text-alert" strokeWidth={1.5} />
                ) : (
                  <BadgeCheck className="h-7 w-7 text-cool" strokeWidth={1.5} />
                )}
                <div
                  className="font-display text-2xl font-light"
                  style={{ color: accent }}
                >
                  {active.verdict}
                </div>
                <code className="font-mono text-[11.5px] text-muted-foreground">
                  {active.code}
                </code>
                <p className="max-w-xs font-body text-sm font-extralight text-muted-foreground">
                  {active.outcome}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>

        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Illustrative values · the same check runs in Verifier.sol on Base Sepolia
        </p>
      </Reveal>
    </section>
  );
}

function HashRow({
  label,
  value,
  tone = "neutral",
  swapKey,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "alert";
  swapKey?: string;
}) {
  const color =
    tone === "alert"
      ? "var(--chap-alert)"
      : tone === "ok"
        ? "var(--chap-cool)"
        : "var(--ink)";

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <AnimatePresence mode="wait">
        <motion.span
          key={`${label}-${swapKey ?? value}`}
          initial={{ opacity: 0, filter: "blur(5px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(5px)" }}
          transition={{ duration: 0.28, ease: EASE }}
          className={cn("tabular-nums")}
          style={{ color }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
