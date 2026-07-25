import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-1.5",
        "font-mono text-[10px] font-normal uppercase tracking-[0.3em] text-cool",
        className,
      )}
      {...props}
    />
  );
}
