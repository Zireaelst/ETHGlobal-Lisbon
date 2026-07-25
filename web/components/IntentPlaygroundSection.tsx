"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BadgeCheck,
  CheckCircle2,
  FileCheck2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";

const PHASES = [
  { key: "intent", label: "Intent", icon: Sparkles, duration: 2200 },
  { key: "enclave", label: "Enclave", icon: ShieldCheck, duration: 2600 },
  { key: "receipt", label: "Receipt", icon: FileCheck2, duration: 2200 },
  { key: "verifier", label: "Verifier", icon: CheckCircle2, duration: 2400 },
  { key: "verified", label: "Verified", icon: BadgeCheck, duration: 3200 },
] as const;

const EASE = [0.16, 1, 0.3, 1] as const;

function IntentPhase() {
  return (
    <>
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Intent
      </div>
      <p className="mt-4 font-body text-lg font-light text-foreground">
        Confidential analysis job — signed, encrypted, priced.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-cool" />
        <span className="font-mono text-[11px] text-muted-foreground">
          Status · Signed (EIP-712)
        </span>
      </div>
    </>
  );
}

function EnclavePhase() {
  return (
    <>
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Enclave
      </div>
      <p className="mt-4 font-body text-lg font-light text-foreground">
        0G Sealed Inference — sealed reasoning in progress.
      </p>
      <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-border/40">
        <motion.div
          className="h-full rounded-full bg-cool"
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 2.4, ease: "easeInOut" }}
        />
      </div>
    </>
  );
}

function ReceiptPhase() {
  const rows = [
    { label: "Intent hash", value: "0x9f3a…c02e" },
    { label: "Output hash", value: "0x71bd…44f1" },
    { label: "Enclave signature", value: "0x2ac0…9d7b" },
  ];
  return (
    <>
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Receipt
      </div>
      <div className="mt-4 flex flex-col gap-2.5 font-mono text-[13px]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function VerifierPhase() {
  const checks = ["Intent signer matches", "Enclave signer matches", "match == true"];
  return (
    <>
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Verifier.sol
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {checks.map((label, i) => (
          <motion.div
            key={label}
            className="flex items-center gap-2.5"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.35, duration: 0.4, ease: EASE }}
          >
            <CheckCircle2 className="h-4 w-4 text-cool" strokeWidth={1.5} />
            <span className="font-body text-sm font-light text-foreground">{label}</span>
          </motion.div>
        ))}
      </div>
    </>
  );
}

function VerifiedPhase() {
  return (
    <div className="flex flex-col items-center gap-3 py-3 text-center">
      <BadgeCheck className="h-8 w-8 text-cool" strokeWidth={1.5} />
      <div className="font-display text-2xl font-light text-foreground">JobVerified</div>
      <p className="max-w-xs font-body text-sm font-extralight text-muted-foreground">
        Settlement releases — the deal Alice ordered, proven.
      </p>
    </div>
  );
}

const PHASE_CONTENT: Record<(typeof PHASES)[number]["key"], () => React.JSX.Element> = {
  intent: IntentPhase,
  enclave: EnclavePhase,
  receipt: ReceiptPhase,
  verifier: VerifierPhase,
  verified: VerifiedPhase,
};

export default function IntentPlaygroundSection() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % PHASES.length);
    }, PHASES[index].duration);
    return () => clearTimeout(timer);
  }, [index]);

  const phase = PHASES[index];
  const Content = PHASE_CONTENT[phase.key];

  return (
    <section id="verification" className="section px-8 py-32 sm:px-16 md:py-40">
      <div className="flex flex-col items-center gap-6 text-center">
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
            performs onchain — no wallet, no network call, just the shape of
            the proof.
          </p>
        </Reveal>
      </div>

      <Reveal delay={220} className="mx-auto mt-16 max-w-xl">
        <div className="relative mb-10 flex items-center justify-between">
          <div
            aria-hidden="true"
            className="absolute left-4 right-4 top-4.5 h-px"
            style={{ background: "var(--line)" }}
          />
          {PHASES.slice(0, 4).map((p, i) => {
            const active = index >= i;
            return (
              <div key={p.key} className="relative z-10 flex flex-col items-center gap-2">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full border bg-background transition-colors duration-500"
                  style={{
                    borderColor: active ? "var(--chap-cool)" : "var(--line)",
                    color: active ? "var(--chap-cool)" : "var(--ink-soft)",
                  }}
                >
                  <p.icon className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  {p.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="relative min-h-[220px] overflow-hidden rounded-3xl border border-border bg-fill p-8 backdrop-blur-xl shadow-[0_20px_60px_-30px_rgba(0,0,0,0.4)] sm:p-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={phase.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <Content />
            </motion.div>
          </AnimatePresence>
        </div>
      </Reveal>
    </section>
  );
}
