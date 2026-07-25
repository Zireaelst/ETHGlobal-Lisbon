"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Aceternity-style "card spotlight": a radial gradient that follows the
 * cursor, masked to the card's border so it reads as a glowing edge rather
 * than a full-card wash. Color follows --chap-warm/--chap-cool via the
 * `tint` prop so it stays inside the shared open/sealed theme system.
 */
export function SpotlightCard({
  children,
  className,
  tint = "warm",
}: {
  children: ReactNode;
  className?: string;
  tint?: "warm" | "cool";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  };

  const background = useMotionTemplate`radial-gradient(220px circle at ${mouseX}px ${mouseY}px, var(--chap-${tint}), transparent 75%)`;

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-fill p-7 transition-colors duration-500 hover:border-foreground/30",
        className,
      )}
    >
      <motion.div
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-500 group-hover:opacity-20"
        style={{ background }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
