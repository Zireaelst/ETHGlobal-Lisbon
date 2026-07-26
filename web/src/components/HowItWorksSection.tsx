"use client";

import { motion } from "motion/react";
import { KeySquare, Radar, ShieldCheck } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";

const STEPS = [
  {
    n: "01",
    icon: Radar,
    title: "Discover",
    body: "Alice finds Bob through the public ERC-8004 registry — skill, endpoint, and encryption pubkey. No prior relationship required.",
    tint: "warm" as const,
  },
  {
    n: "02",
    icon: KeySquare,
    title: "Encrypt & pay",
    body: "The brief and data are ECIES-encrypted to Bob's pubkey. Alice signs an EIP-712 intent hash and authorises an x402 payment — signed, not yet submitted.",
    tint: "cool" as const,
  },
  {
    n: "03",
    icon: ShieldCheck,
    title: "Verify",
    // Not "Bob's enclave" — the recompute runs on an ordinary host (CLAUDE.md
    // §11, and the Architecture section says so twelve lines further down).
    body: "Bob recomputes the hash and signs the match. Verifier.sol recovers both signatures — Alice's intent and Bob's binding key — before a cent moves.",
    tint: "warm" as const,
  },
];

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Deliberately typographic rather than another card grid: this is the
 * narrative arc, and the section below it (Architecture) is the machine.
 * Two card grids back to back would flatten both.
 */
export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="section px-8 py-32 sm:px-16 md:py-40">
      <div className="mx-auto max-w-5xl">
        <Reveal>
          <SectionEyebrow tint="cool">How it works</SectionEyebrow>
        </Reveal>

        <Reveal delay={80}>
          <h2 className="mt-6 max-w-2xl font-display text-4xl font-light tracking-tight text-foreground sm:text-5xl">
            From strangers to settled, without ever meeting.
          </h2>
        </Reveal>

        <ol className="mt-20 grid list-none grid-cols-1 gap-x-10 gap-y-16 p-0 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.n} className="group relative">
              <motion.div
                className="h-px origin-left"
                style={{
                  background:
                    step.tint === "warm"
                      ? "linear-gradient(90deg, var(--chap-warm), transparent)"
                      : "linear-gradient(90deg, var(--chap-cool), transparent)",
                }}
                initial={{ scaleX: 0, opacity: 0 }}
                whileInView={{ scaleX: 1, opacity: 0.7 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.9, delay: i * 0.15, ease: EASE }}
              />

              <Reveal delay={i * 120}>
                <div className="pt-8">
                  <div className="flex items-baseline gap-4">
                    <span className="font-display text-5xl font-extralight leading-none text-muted-foreground/40 transition-colors duration-500 group-hover:text-foreground/70">
                      {step.n}
                    </span>
                    <step.icon
                      className={
                        step.tint === "warm"
                          ? "h-4 w-4 shrink-0 text-warm"
                          : "h-4 w-4 shrink-0 text-cool"
                      }
                      strokeWidth={1.5}
                    />
                  </div>

                  <h3 className="mt-6 font-display text-2xl font-normal text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-3 max-w-sm font-body text-[15px] font-extralight leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
