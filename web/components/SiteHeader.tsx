"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "#thesis", label: "Thesis" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#architecture", label: "Architecture" },
  { href: "#verification", label: "Verification" },
  { href: "#tracks", label: "Tracks" },
];

export default function SiteHeader() {
  const { theme, toggleTheme } = useTheme();
  const sealed = theme === "sealed";

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-8 px-8 py-6 sm:px-16">
      <div className="font-display text-xl uppercase tracking-[0.18em] text-foreground">
        Sealed
      </div>

      <nav className="flex items-center gap-6 font-body text-[13px] font-light tracking-[0.1em] text-muted-foreground sm:gap-10">
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="hidden transition-colors duration-500 hover:text-foreground sm:inline"
          >
            {link.label}
          </a>
        ))}

        <div
          onClick={toggleTheme}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleTheme();
            }
          }}
          role="button"
          tabIndex={0}
          aria-pressed={sealed}
          aria-label="Toggle open/sealed theme"
          className="flex cursor-pointer items-center gap-1 rounded-full border border-border p-1 select-none"
        >
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-500",
              !sealed && "bg-fill text-foreground",
              sealed && "text-muted-foreground",
            )}
          >
            <Sun className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-500",
              sealed && "bg-fill text-foreground",
              !sealed && "text-muted-foreground",
            )}
          >
            <Moon className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
        </div>
      </nav>
    </header>
  );
}
