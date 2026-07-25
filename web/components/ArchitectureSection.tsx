"use client";

import {
  CheckCircle2,
  FileCheck2,
  Link2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AnimatedBeam, type BeamStep } from "@/components/AnimatedBeam";
import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { BentoCard, BentoGrid } from "@/components/ui/bento-card";

const BEAM_STEPS: BeamStep[] = [
  { label: "Intent", icon: Sparkles },
  { label: "TEE", icon: ShieldCheck },
  { label: "Receipt", icon: FileCheck2 },
  { label: "Verifier", icon: CheckCircle2 },
  { label: "Settlement", icon: Link2 },
];

export default function ArchitectureSection() {
  return (
    <section id="architecture" className="section px-8 py-32 sm:px-16 md:py-40">
      <div className="flex flex-col items-center gap-6 text-center">
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
            Every step is checked before the next can happen.
          </p>
        </Reveal>
      </div>

      <BentoGrid className="mx-auto mt-20 max-w-4xl">
        <BentoCard
          icon={<Sparkles className="h-4.5 w-4.5" strokeWidth={1.5} />}
          title="Alice's Intent"
          description="A signed EIP-712 intent hash — brief, data, and price — commits Alice to exactly one job before any bytes move."
        />
        <BentoCard
          icon={<ShieldCheck className="h-4.5 w-4.5" strokeWidth={1.5} />}
          title="Bob's Tapp (TEE)"
          description="An attested enclave recomputes the intent hash and calls 0G Sealed Inference — infra can't see the data."
        />
        <BentoCard
          icon={<FileCheck2 className="h-4.5 w-4.5" strokeWidth={1.5} />}
          title="Signed Receipt"
          description="The Tapp signs {intentHash, outputHash, match} with its ephemeral seal key — proof the right job ran."
        />
        <BentoCard
          icon={<CheckCircle2 className="h-4.5 w-4.5" strokeWidth={1.5} />}
          title="Verifier.sol"
          description="Recovers both signatures onchain, checks match == true, and emits JobVerified before settlement releases."
        />
        <BentoCard
          icon={<Link2 className="h-4.5 w-4.5" strokeWidth={1.5} />}
          title="Base Sepolia Settlement"
          description="The verdict lives on Base; Hedera carries the timeline, The Graph indexes it, 0G ran the compute — no layer duplicates another."
          className="sm:col-span-2"
        />
      </BentoGrid>

      <div className="mx-auto mt-24 max-w-4xl">
        <AnimatedBeam steps={BEAM_STEPS} />
      </div>
    </section>
  );
}
