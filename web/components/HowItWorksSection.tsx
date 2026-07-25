import { KeySquare, Radar, ShieldCheck } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { SpotlightCard } from "@/components/ui/spotlight-card";

const STEPS = [
  {
    n: "01",
    icon: Radar,
    title: "Discover",
    body: "Alice finds Bob through the public ERC-8004 registry — skill, endpoint, and encryption pubkey, no prior relationship required.",
    tint: "warm" as const,
  },
  {
    n: "02",
    icon: KeySquare,
    title: "Encrypt & pay",
    body: "The brief and data are ECIES-encrypted to Bob's pubkey; Alice signs an EIP-712 intent hash and pays over x402.",
    tint: "cool" as const,
  },
  {
    n: "03",
    icon: ShieldCheck,
    title: "Verify",
    body: "Bob's Tapp recomputes the intent hash inside a TEE, calls 0G Sealed Inference, and signs the match. Verifier.sol checks both signatures before settlement releases.",
    tint: "warm" as const,
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="section px-8 py-32 sm:px-16 md:py-40">
      <Reveal>
        <SectionEyebrow tint="cool">How it works</SectionEyebrow>
      </Reveal>

      <ol className="mt-14 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step, i) => (
          <Reveal key={step.n} delay={i * 120}>
            <li className="h-full">
              <SpotlightCard tint={step.tint} className="flex h-full flex-col gap-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border">
                    <step.icon className="h-4.5 w-4.5 text-warm" strokeWidth={1.5} />
                  </span>
                  <span className="font-mono text-xs tracking-[0.2em] text-muted-foreground">
                    {step.n}
                  </span>
                </div>
                <h3 className="font-display text-2xl font-normal text-foreground">
                  {step.title}
                </h3>
                <p className="font-body text-[15px] font-extralight leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </SpotlightCard>
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}
