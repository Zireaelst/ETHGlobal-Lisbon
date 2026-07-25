"use client";

import { ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import { Reveal } from "@/components/Reveal";

export default function FraudDemoTeaser() {
  return (
    <section className="section flex justify-center px-8 py-24 sm:px-16">
      <Reveal className="relative w-full max-w-xl">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background:
              "radial-gradient(closest-side, var(--chap-cool), transparent 70%)",
          }}
          animate={{ opacity: [0.06, 0.16, 0.06] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative flex flex-col items-center gap-5 rounded-2xl border border-dashed border-border p-10 text-center">
          <ShieldAlert className="h-6 w-6 text-cool" strokeWidth={1.5} />
          <span className="rounded-full border border-border px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-cool">
            Coming soon
          </span>
          <p className="font-body text-base font-extralight leading-relaxed text-muted-foreground">
            A single flag makes Bob answer a different job. The contract
            catches the mismatch and rejects it — live, on-chain.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
