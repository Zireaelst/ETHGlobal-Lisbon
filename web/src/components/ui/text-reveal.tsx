"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Word-by-word reveal on scroll, in the style of Aceternity's
 * "Text Generate Effect" — each word fades and lifts in with a small
 * stagger as the block enters the viewport.
 */
export function TextReveal({
  text,
  className,
  wordClassName,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
}) {
  const words = text.split(" ");

  return (
    <motion.p
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.4 }}
      transition={{ staggerChildren: 0.03 }}
    >
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className={cn("inline-block", wordClassName)}
          variants={{
            hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
            visible: { opacity: 1, y: 0, filter: "blur(0px)" },
          }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </motion.p>
  );
}
