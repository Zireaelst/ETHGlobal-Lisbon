import type { AnchorHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center gap-3 font-body text-sm font-light tracking-[0.1em] uppercase transition-all duration-500",
  {
    variants: {
      variant: {
        primary:
          "rounded-full border border-border bg-fill px-8 py-4 text-foreground backdrop-blur-md hover:border-foreground hover:tracking-[0.14em]",
        ghost: "tracking-[0.08em] text-muted-foreground hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

interface ButtonLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof buttonVariants> {}

export function ButtonLink({ className, variant, ...props }: ButtonLinkProps) {
  return <a className={cn(buttonVariants({ variant }), className)} {...props} />;
}
