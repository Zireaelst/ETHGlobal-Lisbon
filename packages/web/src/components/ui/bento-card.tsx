"use client";

import type { ReactNode, Ref } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

export const flowCardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE },
  },
};

export type FlowTint = "warm" | "cool";

/**
 * One stage of the protocol, as a bento cell.
 *
 * Three states rather than the usual two: `active` (the stage the flow has
 * reached, or the one being hovered) lifts and lights its accent edge,
 * `dimmed` recedes so a single stage can own the reader's attention, and
 * idle sits in between. The technical proof line is deliberately hidden
 * until a stage is active — the grid has to be readable at a glance first,
 * and only reward a reader who leans in.
 */
export function FlowCard({
  ref,
  index,
  icon,
  title,
  description,
  detail,
  tag,
  tint = "cool",
  state = "idle",
  connected = false,
  onActivate,
  onDismiss,
  className,
}: {
  ref?: Ref<HTMLDivElement>;
  index: number;
  icon: ReactNode;
  title: string;
  description: string;
  detail: string;
  tag: string;
  tint?: FlowTint;
  state?: "idle" | "active" | "dimmed";
  /** another stage follows this one — draw the single-column connector */
  connected?: boolean;
  onActivate?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const accent = tint === "warm" ? "var(--chap-warm)" : "var(--chap-cool)";
  const active = state === "active";

  return (
    // The outer layer owns the staggered entrance variant handed down by the
    // grid. The hover state on the inner layer is plain CSS on purpose: a
    // nested motion child inside a variant tree ignores its own `animate`
    // object, and transitioning opacity/transform in CSS is cheaper anyway.
    <motion.div
      ref={ref}
      variants={flowCardVariants}
      className={cn("relative", className)}
    >
      {/* The SVG beams only exist once the grid is wide enough to lay the
          stages out as a circuit. Stacked in one column they still need to
          read as a sequence, so the gap gets a hairline instead. */}
      {connected && (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-full h-5 w-px -translate-x-1/2 bg-gradient-to-b from-border to-transparent sm:hidden"
        />
      )}

      <div
        role="button"
        tabIndex={0}
        aria-pressed={active}
        onMouseEnter={onActivate}
        onMouseLeave={onDismiss}
        onFocus={onActivate}
        onBlur={onDismiss}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate?.();
          }
        }}
        style={{
          opacity: state === "dimmed" ? 0.45 : 1,
          transform: active ? "translateY(-6px) scale(1.015)" : "none",
        }}
        className={cn(
          "group relative z-10 flex h-full cursor-pointer flex-col overflow-hidden rounded-3xl",
          "border border-border bg-fill p-7 outline-none backdrop-blur-xl",
          "shadow-[0_20px_60px_-30px_rgba(0,0,0,0.4)]",
          "transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
        )}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-3xl transition-opacity duration-500"
          style={{
            opacity: active ? 1 : 0,
            boxShadow: `inset 0 0 0 1px ${accent}, 0 0 52px -16px ${accent}`,
          }}
        />

        <div className="relative flex items-center justify-between gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full border transition-colors duration-500"
            style={{
              borderColor: active ? accent : "var(--line)",
              color: active ? accent : "var(--ink)",
            }}
          >
            {icon}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            {String(index).padStart(2, "0")}
          </span>
        </div>

        <h3 className="relative mt-5 font-display text-lg font-normal text-foreground">
          {title}
        </h3>

        {/* The proof line cross-fades over the description rather than
            expanding below it. The cell height is fixed by the grid row, so
            anything additive would either clip or shove the row around —
            and sharing the slot makes it read as flipping the same block
            over to its technical side. */}
        <div className="relative mt-2">
          <p
            className="font-body text-[13.5px] font-light leading-relaxed text-muted-foreground transition-opacity duration-400"
            style={{ opacity: active ? 0 : 1 }}
          >
            {description}
          </p>
          <p
            aria-hidden={!active}
            className="absolute inset-0 font-mono text-[10.5px] leading-relaxed break-words transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              color: accent,
              opacity: active ? 1 : 0,
              transform: active ? "none" : "translateY(6px)",
            }}
          >
            {detail}
          </p>
        </div>

        <div className="relative mt-auto pt-6">
          <span
            className="font-mono text-[9.5px] uppercase tracking-[0.22em] transition-colors duration-500"
            style={{ color: active ? accent : "var(--ink-soft)" }}
          >
            {tag}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      transition={{ staggerChildren: 0.1 }}
      className={cn("grid gap-5", className)}
    >
      {children}
    </motion.div>
  );
}
