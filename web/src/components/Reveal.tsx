"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

export function Reveal({
  children,
  className,
  delay = 0,
  immediate = false,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  /**
   * Animate on mount instead of on scroll. Required for anything ALREADY on screen when the
   * page opens: `whileInView` is driven by an intersection *change*, and content sitting at
   * the top of the document from the first frame may never produce one — it then stays at
   * `initial`, i.e. invisible, until the reader happens to scroll. Every use on the landing
   * page sits below a full-height hero, so this never came up there; a page that starts with
   * its own heading (/spec) hits it immediately.
   */
  immediate?: boolean;
}) {
  const shown = { opacity: 1, y: 0 };
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      {...(immediate
        ? { animate: shown }
        : { whileInView: shown, viewport: { once: true, amount: 0.2 } })}
      transition={{ duration: 0.8, delay: delay / 1000, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
