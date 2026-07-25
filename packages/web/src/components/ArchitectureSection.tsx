"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  CheckCircle2,
  FileCheck2,
  Link2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import {
  AnimatedBeamGroup,
  type BeamSpec,
} from "@/components/ui/animated-beam";
import { BentoGrid, FlowCard, type FlowTint } from "@/components/ui/bento-card";
import { cn } from "@/lib/utils";

const STAGES = [
  {
    key: "intent",
    icon: Sparkles,
    title: "Human intent",
    description:
      "Alice commits to exactly one job — brief, data, constraints, price — and signs it before a single byte moves.",
    detail: "keccak256(brief, data, constraints, price, nonce)",
    tag: "Client · EIP-712",
    tint: "warm" as FlowTint,
    span: "lg:col-span-2",
  },
  {
    key: "tee",
    icon: ShieldCheck,
    title: "Sealed inference",
    description:
      "An attested enclave decrypts the brief, recomputes the hash, and runs the model on 0G Sealed Inference. The infra never sees the data.",
    detail: "TeeML → /chat/completions → verify TEE signature",
    tag: "Enclave · 0G",
    tint: "cool" as FlowTint,
    span: "lg:col-span-2",
  },
  {
    key: "receipt",
    icon: FileCheck2,
    title: "Cryptographic receipt",
    description:
      "The enclave signs the intent, the output, and its verdict with an ephemeral seal key issued to its own measured image.",
    detail: "sign(sealKey) → { intentHash, outputHash, match }",
    tint: "cool" as FlowTint,
    tag: "Enclave · seal key",
    span: "lg:col-span-2",
  },
  {
    key: "verifier",
    icon: CheckCircle2,
    title: "On-chain verifier",
    description:
      "Verifier.sol recovers both signatures independently — Alice's and the enclave's — and refuses anything where match is false.",
    detail: "ecrecover(sig) == registered signer && match",
    tag: "Base Sepolia · Verifier.sol",
    tint: "cool" as FlowTint,
    span: "lg:col-span-3",
  },
  {
    key: "settlement",
    icon: Link2,
    title: "Blockchain execution",
    description:
      "Only after JobVerified is emitted does payment settle. The verdict is public; the work behind it never was.",
    detail: "emit JobVerified(intentHash, outputHash) → settle",
    tag: "Settled after verification",
    tint: "warm" as FlowTint,
    span: "lg:col-span-3",
  },
];

const STEP_MS = 720;

export default function ArchitectureSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ];

  // -1 before the flow starts; advances one stage at a time once the grid
  // scrolls into view, then rests at the last stage.
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!running) return;
    if (step >= STAGES.length - 1) {
      setRunning(false);
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [running, step]);

  const play = useCallback(() => {
    setRevealed(true);
    setStep(-1);
    setRunning(true);
  }, []);

  // Taking over mid-sequence jumps the flow to its end rather than freezing
  // it: a reader who reaches for a card should get the finished diagram,
  // not one stalled halfway through lighting up.
  const takeOver = useCallback((i: number) => {
    setRunning(false);
    setStep(STAGES.length - 1);
    setHovered(i);
  }, []);

  // Plain IntersectionObserver rather than a motion viewport callback: this
  // has to fire exactly once, on the grid itself, and stay decoupled from
  // whatever the card entrance animation is doing.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        play();
      },
      { threshold: 0.15 },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [play]);

  const beams = useMemo<BeamSpec[]>(
    () => [
      { from: cardRefs[0], to: cardRefs[1], fromAnchor: "right", toAnchor: "left" },
      { from: cardRefs[1], to: cardRefs[2], fromAnchor: "right", toAnchor: "left" },
      { from: cardRefs[2], to: cardRefs[3], fromAnchor: "bottom", toAnchor: "top" },
      { from: cardRefs[3], to: cardRefs[4], fromAnchor: "right", toAnchor: "left" },
    ],
    // Refs are stable for the life of the section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Hover wins over the autoplay cursor, so leaning on a card always
  // explains that card rather than fighting the running sequence.
  const focused = hovered ?? (running ? step : null);

  return (
    <section id="architecture" className="section px-8 py-32 sm:px-16 md:py-40">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
        <Reveal>
          <SectionEyebrow tint="warm">Architecture</SectionEyebrow>
        </Reveal>

        <Reveal delay={80}>
          <h2 className="font-display text-4xl font-light tracking-tight text-foreground sm:text-5xl md:text-6xl">
            One intent. One verdict.
          </h2>
        </Reveal>

        <Reveal delay={160}>
          <p className="max-w-md font-body text-base font-extralight leading-relaxed text-muted-foreground">
            Follow the thread. Every stage checks the one before it, and
            nothing settles until the chain agrees.
          </p>
        </Reveal>
      </div>

      <div ref={containerRef} className="relative mx-auto mt-20 max-w-5xl">
        <AnimatedBeamGroup
          containerRef={containerRef}
          beams={beams}
          revealed={revealed}
          progress={step - 1}
          activeIndex={
            hovered !== null && hovered < beams.length ? hovered : null
          }
          enabled={wide}
        />

        <BentoGrid className="sm:grid-cols-2 lg:grid-cols-6 lg:gap-x-6 lg:gap-y-14">
          {STAGES.map((stage, i) => (
            <FlowCard
              key={stage.key}
              ref={cardRefs[i]}
              index={i + 1}
              icon={<stage.icon className="h-4.5 w-4.5" strokeWidth={1.5} />}
              title={stage.title}
              description={stage.description}
              detail={stage.detail}
              tag={stage.tag}
              tint={stage.tint}
              state={
                focused === null ? "idle" : focused === i ? "active" : "dimmed"
              }
              connected={i < STAGES.length - 1}
              onActivate={() => takeOver(i)}
              onDismiss={() => setHovered(null)}
              className={cn(stage.span, i === 2 && "sm:col-span-2")}
            />
          ))}
        </BentoGrid>
      </div>

      <motion.div
        className="mx-auto mt-14 flex max-w-5xl flex-col items-center gap-6 sm:flex-row sm:justify-between"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        <p className="order-2 text-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground sm:order-1 sm:text-left">
          Base is the verdict · Hedera the timeline · The Graph the read layer ·
          0G the compute
        </p>

        <button
          type="button"
          onClick={play}
          className="order-1 flex shrink-0 items-center gap-2.5 rounded-full border border-border px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground transition-colors duration-500 hover:border-foreground/40 hover:text-foreground sm:order-2"
        >
          <RotateCcw
            className={`h-3 w-3 ${running ? "animate-spin" : ""}`}
            strokeWidth={1.5}
          />
          Replay flow
        </button>
      </motion.div>
    </section>
  );
}
