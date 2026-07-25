import { GitBranch } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { GlowButton } from "@/components/ui/glow-button";

export default function CtaFooter() {
  return (
    <footer className="section flex flex-col items-center gap-7 px-8 py-24 text-center sm:px-16 sm:py-32">
      <Reveal>
        <GlowButton href="#">
          <GitBranch className="h-4 w-4" strokeWidth={1.5} />
          Explore the repo
        </GlowButton>
      </Reveal>

      <Reveal delay={120}>
        <p className="max-w-xl font-body text-[13px] font-extralight leading-relaxed text-muted-foreground">
          This is feedback anchored to paid, verified jobs — not Sybil-proof
          reputation. The binding catches task substitution and input
          tampering, not all prompt injection. Signatures are verified
          on-chain; enclave attestation is checked off-chain at setup.
        </p>
      </Reveal>

      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        0G · The Graph · Hedera
      </div>
    </footer>
  );
}
