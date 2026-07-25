"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

export interface BeamStep {
  label: string;
  icon: LucideIcon;
}

function BeamNode({ step, index }: { step: BeamStep; index: number }) {
  return (
    <motion.div
      className="relative z-10 flex flex-row items-center gap-4 lg:flex-1 lg:flex-col lg:items-center lg:gap-3"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.6, delay: index * 0.1, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground"
        animate={{
          boxShadow: [
            "0 0 0px 0px var(--chap-cool)",
            "0 0 18px 2px var(--chap-cool)",
            "0 0 0px 0px var(--chap-cool)",
          ],
        }}
        transition={{
          duration: 2.4,
          repeat: Infinity,
          delay: index * 0.4,
          ease: "easeInOut",
        }}
      >
        <step.icon className="h-5 w-5" strokeWidth={1.5} />
      </motion.div>
      <span className="text-left font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground lg:text-center">
        {step.label}
      </span>
    </motion.div>
  );
}

/**
 * A slow, continuous left-to-right (top-to-bottom on mobile) light that
 * travels the track behind the nodes, plus a soft, staggered pulse on each
 * node as if the beam were reaching it. Elegant and slow by design — this
 * loops forever but is never meant to grab attention on its own.
 */
export function AnimatedBeam({ steps }: { steps: BeamStep[] }) {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute left-7 right-7 top-7 hidden h-px lg:block"
        style={{ background: "var(--line)" }}
      >
        <motion.div
          className="absolute top-1/2 h-px w-1/5 -translate-y-1/2"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--chap-warm), var(--chap-cool), transparent)",
          }}
          animate={{ left: ["0%", "80%"] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div
        aria-hidden="true"
        className="absolute bottom-7 left-7 top-7 w-px lg:hidden"
        style={{ background: "var(--line)" }}
      >
        <motion.div
          className="absolute left-1/2 h-1/5 w-px -translate-x-1/2"
          style={{
            background:
              "linear-gradient(180deg, transparent, var(--chap-warm), var(--chap-cool), transparent)",
          }}
          animate={{ top: ["0%", "80%"] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
        {steps.map((step, i) => (
          <BeamNode key={step.label} step={step} index={i} />
        ))}
      </div>
    </div>
  );
}
