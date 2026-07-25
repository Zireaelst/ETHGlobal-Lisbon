"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BadgeCheck,
  CheckCircle2,
  FileCheck2,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";

const PHASES = [
  { key: "intent", label: "Intent", icon: Sparkles, duration: 2600 },
  { key: "enclave", label: "Enclave", icon: ShieldCheck, duration: 3000 },
  { key: "receipt", label: "Receipt", icon: FileCheck2, duration: 2800 },
  { key: "verifier", label: "Verifier", icon: CheckCircle2, duration: 3000 },
  { key: "verified", label: "Verified", icon: BadgeCheck, duration: 3600 },
] as const;

const EASE = [0.16, 1, 0.3, 1] as const;

function IntentPhase() {
  return (
    <>
      <p className="font-body text-lg font-light text-foreground">
        Confidential analysis job — signed, encrypted, priced.
      </p>
      <div className="mt-6 flex flex-col gap-2.5 font-mono text-[12.5px]">
        <Row label="Signer" value="alice.eth" />
        <Row label="Scheme" value="EIP-712" />
        <Row label="Intent hash" value="0x9f3a…c02e" />
      </div>
    </>
  );
}

function EnclavePhase() {
  return (
    <>
      <p className="font-body text-lg font-light text-foreground">
        0G Sealed Inference — sealed reasoning in progress.
      </p>
      <p className="mt-3 font-mono text-[12px] text-muted-foreground">
        Recomputed hash matches the intent. Running the model.
      </p>
      <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-border/40">
        <motion.div
          className="h-full rounded-full bg-cool"
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 2.6, ease: "easeInOut" }}
        />
      </div>
    </>
  );
}

function ReceiptPhase() {
  return (
    <>
      <p className="font-body text-lg font-light text-foreground">
        The enclave signs what it just did.
      </p>
      <div className="mt-6 flex flex-col gap-2.5 font-mono text-[12.5px]">
        <Row label="Intent hash" value="0x9f3a…c02e" />
        <Row label="Output hash" value="0x71bd…44f1" />
        <Row label="Enclave signature" value="0x2ac0…9d7b" />
      </div>
    </>
  );
}

function VerifierPhase() {
  const checks = [
    "Intent signer matches the registered client",
    "Enclave signer matches the registered seal key",
    "match == true",
  ];
  return (
    <>
      <p className="font-body text-lg font-light text-foreground">
        Verifier.sol recovers both signatures.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        {checks.map((label, i) => (
          <motion.div
            key={label}
            className="flex items-center gap-2.5"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.35, duration: 0.4, ease: EASE }}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-cool" strokeWidth={1.5} />
            <span className="font-body text-sm font-light text-foreground">
              {label}
            </span>
          </motion.div>
        ))}
      </div>
    </>
  );
}

function VerifiedPhase() {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <BadgeCheck className="h-8 w-8 text-cool" strokeWidth={1.5} />
      <div className="font-display text-2xl font-light text-foreground">
        JobVerified
      </div>
      <p className="max-w-xs font-body text-sm font-extralight text-muted-foreground">
        Settlement releases — the job Alice ordered, proven.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

const PHASE_CONTENT: Record<
  (typeof PHASES)[number]["key"],
  () => React.JSX.Element
> = {
  intent: IntentPhase,
  enclave: EnclavePhase,
  receipt: ReceiptPhase,
  verifier: VerifierPhase,
  verified: VerifiedPhase,
};

export default function IntentPlaygroundSection() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % PHASES.length);
    }, PHASES[index].duration);
    return () => clearTimeout(timer);
  }, [index, playing]);

  // Jumping to a phase hands control to the reader — an autoplay that keeps
  // yanking the panel away after a click is the most annoying thing a demo
  // like this can do.
  const goTo = useCallback((i: number) => {
    setPlaying(false);
    setIndex(i);
  }, []);

  const phase = PHASES[index];
  const Content = PHASE_CONTENT[phase.key];

  return (
    <section id="verification" className="section px-8 py-32 sm:px-16 md:py-40">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
        <Reveal>
          <SectionEyebrow tint="cool">Verification</SectionEyebrow>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="font-display text-4xl font-light tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Watch an intent become a verdict
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="max-w-xl font-body text-base font-extralight leading-relaxed text-muted-foreground">
            An illustrative walkthrough of the same checks Verifier.sol
            performs on-chain — no wallet, no network call, just the shape of
            the proof. Step through it yourself.
          </p>
        </Reveal>
      </div>

      <Reveal delay={220} className="mx-auto mt-16 max-w-xl">
        <div className="relative mb-10 flex items-start justify-between">
          <div
            aria-hidden="true"
            className="absolute left-4 right-4 top-4.5 h-px"
            style={{ background: "var(--line)" }}
          />
          <motion.div
            aria-hidden="true"
            className="absolute left-4 top-4.5 h-px origin-left"
            style={{
              right: "1rem",
              background:
                "linear-gradient(90deg, var(--chap-warm), var(--chap-cool))",
            }}
            animate={{ scaleX: index / (PHASES.length - 1) }}
            transition={{ duration: 0.6, ease: EASE }}
          />

          {PHASES.map((p, i) => {
            const reached = index >= i;
            const current = index === i;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => goTo(i)}
                aria-current={current}
                className="relative z-10 flex flex-col items-center gap-2 outline-none"
              >
                <motion.span
                  className="flex h-9 w-9 items-center justify-center rounded-full border bg-background"
                  animate={{
                    borderColor: reached ? "var(--chap-cool)" : "var(--line)",
                    color: reached ? "var(--chap-cool)" : "var(--ink-soft)",
                    scale: current ? 1.12 : 1,
                  }}
                  whileHover={{ scale: 1.18 }}
                  transition={{ type: "spring", stiffness: 320, damping: 20 }}
                >
                  <p.icon className="h-4 w-4" strokeWidth={1.5} />
                </motion.span>
                <span
                  className="font-mono text-[9px] uppercase tracking-[0.16em] transition-colors duration-300"
                  style={{
                    color: current ? "var(--ink)" : "var(--ink-soft)",
                  }}
                >
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="relative flex min-h-[260px] flex-col overflow-hidden rounded-3xl border border-border bg-fill p-8 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-10"
          onMouseEnter={() => setPlaying(false)}
        >
          {playing && (
            <motion.div
              key={`bar-${index}`}
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px origin-left bg-cool/70"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: phase.duration / 1000, ease: "linear" }}
            />
          )}

          <div className="mb-5 flex items-center justify-between gap-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {phase.label}
            </span>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-500 hover:border-foreground/40 hover:text-foreground"
            >
              {playing ? (
                <Pause className="h-3 w-3" strokeWidth={1.5} />
              ) : (
                <Play className="h-3 w-3" strokeWidth={1.5} />
              )}
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={phase.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease: EASE }}
            >
              <Content />
            </motion.div>
          </AnimatePresence>
        </div>
      </Reveal>
    </section>
  );
}
