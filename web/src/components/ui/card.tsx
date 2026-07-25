import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("font-display text-xl font-normal text-foreground", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("mt-3 font-body text-sm font-light leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}
