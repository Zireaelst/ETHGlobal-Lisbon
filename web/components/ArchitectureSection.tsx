"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { SpotlightCard } from "@/components/ui/spotlight-card";

const NODES = [
  { label: "Alice-agent", detail: "discovers · signs intent · pays", tint: "warm" as const },
  { label: "Bob's Tapp (TEE #1)", detail: "recomputes hash · checks match", tint: "cool" as const },
  { label: "0G Sealed Inference (TEE #2)", detail: "runs the model", tint: "cool" as const },
  { label: "Verifier.sol", detail: "checks both signatures on-chain", tint: "warm" as const },
];

export default function ArchitectureSection() {
  return (
    <section id="architecture" className="section px-8 py-32 sm:px-16 md:py-40">
      <Reveal>
        <SectionEyebrow tint="warm">Architecture</SectionEyebrow>
      </Reveal>

      <Reveal
        delay={120}
        className="mt-14 flex flex-col items-stretch gap-4 lg:flex-row lg:items-center lg:gap-3"
      >
        {NODES.map((node, i) => (
          <div key={node.label} className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-center">
            <SpotlightCard tint={node.tint} className="min-w-[180px] p-5">
              <div className="font-mono text-xs tracking-wide text-foreground">
                {node.label}
              </div>
              <div className="mt-2 font-body text-[13px] font-extralight text-muted-foreground">
                {node.detail}
              </div>
            </SpotlightCard>
            {i < NODES.length - 1 && (
              <motion.div
                className="flex shrink-0 items-center justify-center self-center"
                animate={{ x: [0, 6, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
              >
                <ArrowRight
                  aria-hidden="true"
                  strokeWidth={1.5}
                  className="h-5 w-5 rotate-90 text-cool lg:rotate-0"
                />
              </motion.div>
            )}
          </div>
        ))}
      </Reveal>

      <Reveal delay={240}>
        <p className="mt-10 font-mono text-xs tracking-wide text-muted-foreground">
          Base = the verdict · Hedera = the timeline · The Graph = the read
          layer · 0G = the compute.
        </p>
      </Reveal>
    </section>
  );
}
