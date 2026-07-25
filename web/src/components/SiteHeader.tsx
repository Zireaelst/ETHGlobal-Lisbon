"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "#thesis", label: "Thesis" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#architecture", label: "Architecture" },
  { href: "#verification", label: "Verification" },
  { href: "#fraud", label: "Fraud path" },
  { href: "#tracks", label: "Tracks" },
];

/**
 * Marks the section currently under the header. The hero has no id, so
 * nothing is active while it is on screen — which is correct: the nav is
 * for the document below the hero.
 */
function useActiveSection() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const ids = NAV_LINKS.map((l) => l.href.slice(1));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(`#${visible[0].target.id}`);
      },
      // A band just under the header, so "active" means "at the top of the
      // viewport" rather than "anywhere on screen".
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return active;
}

export default function SiteHeader() {
  const { theme, toggleTheme } = useTheme();
  const sealed = theme === "sealed";
  const active = useActiveSection();
  const [scrolled, setScrolled] = useState(false);

  // The hero is meant to be seen edge to edge, so the header stays fully
  // transparent over it and only earns a scrim once real content starts
  // passing underneath — section headings were running straight through it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-8 px-8 py-6 transition-all duration-700 sm:px-16",
        scrolled && "border-b border-border/60 backdrop-blur-xl",
      )}
      style={
        scrolled
          ? { background: "color-mix(in srgb, var(--bg) 72%, transparent)" }
          : undefined
      }
    >
      <div className="font-display text-xl uppercase tracking-[0.18em] text-foreground">
        Sealed
      </div>

      <nav className="flex items-center gap-6 font-body text-[13px] font-light tracking-[0.1em] text-muted-foreground lg:gap-8">
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={active === link.href ? "true" : undefined}
            className={cn(
              "relative hidden transition-colors duration-500 hover:text-foreground lg:inline",
              active === link.href && "text-foreground",
            )}
          >
            {link.label}
            {active === link.href && (
              <motion.span
                layoutId="nav-active"
                className="absolute -bottom-1.5 left-0 right-0 h-px bg-gradient-to-r from-warm to-cool"
                transition={{ type: "spring", stiffness: 340, damping: 32 }}
              />
            )}
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
