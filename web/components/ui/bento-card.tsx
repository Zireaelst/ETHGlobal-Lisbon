"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
  },
};

/**
 * A premium "glass" bento cell: light marble glass in the open theme,
 * obsidian glass in sealed, with a gold or blue accent (matching the
 * theme) that only appears as a border/glow on hover — never a passive
 * decoration, per the same "libraries for interaction, not for design"
 * principle the rest of the page follows.
 */
export function BentoCard({
  icon,
  title,
  description,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  className?: string;
}) {
  const { theme } = useTheme();
  const accent = theme === "open" ? "var(--chap-warm)" : "var(--chap-cool)";

  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ scale: 1.02, y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-border bg-fill p-8 backdrop-blur-xl",
        "shadow-[0_20px_60px_-30px_rgba(0,0,0,0.4)]",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ boxShadow: `inset 0 0 0 1px ${accent}, 0 0 44px -14px ${accent}` }}
      />

      {icon && (
        <div className="relative mb-6 flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground">
          {icon}
        </div>
      )}
      <h3 className="relative font-display text-xl font-normal text-foreground">
        {title}
      </h3>
      <p className="relative mt-3 font-body text-sm font-light leading-relaxed text-muted-foreground">
        {description}
      </p>
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
      transition={{ staggerChildren: 0.12 }}
      className={cn("grid grid-cols-1 gap-5 sm:grid-cols-2", className)}
    >
      {children}
    </motion.div>
  );
}
