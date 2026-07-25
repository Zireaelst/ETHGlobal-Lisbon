"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Aceternity-style "moving border" button: a conic gradient rotates behind
 * a pill-shaped label, read through a thin border. Rotation uses the shared
 * warm/cool accent colors so it stays inside the open/sealed theme.
 */
export function GlowButton({
  children,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  return (
    <a
      className={cn(
        "group relative inline-flex overflow-hidden rounded-full p-[1px]",
        className,
      )}
      {...props}
    >
      <motion.span
        className="absolute inset-[-1000%]"
        style={{
          background:
            "conic-gradient(from 90deg at 50% 50%, var(--chap-warm) 0%, var(--chap-cool) 50%, var(--chap-warm) 100%)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />
      <span className="relative inline-flex items-center gap-3 rounded-full bg-background px-8 py-4 font-body text-sm font-light uppercase tracking-[0.1em] text-foreground backdrop-blur-md transition-colors duration-500 group-hover:tracking-[0.14em]">
        {children}
      </span>
    </a>
  );
}
