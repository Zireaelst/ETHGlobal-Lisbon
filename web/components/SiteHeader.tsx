"use client";

import { useTheme } from "@/lib/theme";
import styles from "./SiteHeader.module.css";

const NAV_LINKS = [
  { href: "#thesis", label: "Thesis" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#architecture", label: "Architecture" },
  { href: "#tracks", label: "Tracks" },
];

export default function SiteHeader() {
  const { theme, toggleTheme } = useTheme();
  const sealed = theme === "sealed";

  return (
    <header className={styles.header}>
      <div className={styles.wordmark}>Sealed</div>
      <nav className={styles.nav}>
        {NAV_LINKS.map((link) => (
          <a key={link.href} href={link.href} className={styles.navLink}>
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
          className={styles.toggle}
          aria-pressed={sealed}
          aria-label="Toggle open/sealed theme"
        >
          <span className={styles.toggleLabel} data-active={!sealed}>
            Open
          </span>
          <span className={styles.rail}>
            <span className={styles.knob} data-sealed={sealed} />
          </span>
          <span className={styles.toggleLabel} data-active={sealed}>
            Sealed
          </span>
        </div>
      </nav>
    </header>
  );
}
