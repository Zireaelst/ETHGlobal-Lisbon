# Landing Page (below-the-hero sections) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared open/sealed theme system, a persistent site header, and the six static sections below the Cinematic Hero (Thesis, How it works, Architecture, Tracks, Fraud demo teaser, CTA/Footer), per `docs/superpowers/specs/2026-07-25-landing-page-design.md`.

**Architecture:** A React Context (`ThemeProvider`) owns `theme: 'open' | 'sealed'`, persists it to `localStorage`, and writes it as CSS custom properties on `<html>`. The already-implemented `CinematicHero` stops owning theme state and reads/writes through this context instead. A new fixed `SiteHeader` carries the nav + toggle that used to live inside the hero. The six new sections are plain Server Components styled entirely through the shared CSS custom properties — no client-side JS, no new dependencies.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript, CSS Modules, `node --test` + `tsx` for the two pure-logic unit tests (no jsdom/RTL — presentational components are verified via `next build` + manual browser check, per project convention of testing UI in the browser rather than mocking the DOM).

## Global Constraints

- Node 20+, pnpm — matches root project (`CLAUDE.md` §4).
- TypeScript strict mode (already set in `web/tsconfig.json`) — every new file must typecheck under `npx tsc --noEmit` from `web/`.
- No new runtime dependencies. The only new devDependency is `tsx` (already used at the repo root, same version pin) for running the two pure-logic tests.
- No Tailwind, no component library — this codebase's existing pattern (see `CinematicHero.tsx`) is inline styles + CSS Modules; stay consistent.
- Every color in every new/modified file must come from the shared CSS custom properties (`--bg`, `--ink`, `--ink-soft`, `--line`, `--fill`, `--chap-warm`, `--chap-cool`) or from `web/lib/theme-tokens.ts` — no new hardcoded hex/rgba colors anywhere else.
- Fonts: reuse the existing `--font-display` / `--font-body` / `--font-mono` CSS variables set in `web/app/layout.tsx`. Do not add new font imports.
- All CTAs/anchors point only to in-page `#id` anchors or a bare `#` placeholder. Never link to a demo route — `web/app/dashboard` is a stub, not a working demo.
- `CinematicHero.tsx`'s scroll-driven parallax/paint loop must keep working exactly as before — only its theme *source* changes (context instead of local state).
- Work happens on the `landing-page` git branch. Commit after every task. Never push or merge to `main`.

---

## File Structure

| File | Responsibility |
|---|---|
| `web/lib/theme-tokens.ts` | Pure data: the open/sealed RGBA color pairs, and pure functions to format them as CSS. No React. |
| `web/lib/theme-tokens.test.ts` | Unit tests for the above. |
| `web/lib/theme.tsx` | `"use client"` — `ThemeProvider` (React Context) + `useTheme()` hook. Owns theme state, localStorage, and writing CSS vars to `<html>`. |
| `web/components/SiteHeader.tsx` + `.module.css` | Fixed header: wordmark, anchor nav, and the open/sealed toggle (reads `useTheme()`). |
| `web/components/CinematicHero.tsx` | *Modified* — drops its own top nav and local theme state; reads `useTheme()` instead. |
| `web/app/globals.css` | *Modified* — adds `:root` default CSS vars (pre-hydration) and a shared `.section` utility class. |
| `web/components/ThesisSection.tsx` + `.module.css` | "The problem / the answer" editorial block. |
| `web/components/HowItWorksSection.tsx` + `.module.css` | 3-step Alice→Bob flow. |
| `web/components/ArchitectureSection.tsx` + `.module.css` | Box-and-arrow diagram + the Base/Hedera/Graph/0G legend line. |
| `web/components/TracksSection.tsx` + `.module.css` | 0G / The Graph / Hedera cards. |
| `web/components/FraudDemoTeaser.tsx` + `.module.css` | "Coming soon" placeholder card. |
| `web/components/CtaFooter.tsx` + `.module.css` | Repo CTA + honest-boundaries note + track marks. |
| `web/app/page.tsx` | *Modified* — wraps everything in `ThemeProvider`, adds `SiteHeader` and the six sections. |
| `web/package.json` | *Modified* — adds `tsx` devDependency + `test` script. |

---

### Task 1: Theme tokens (pure data + tests)

**Files:**
- Create: `web/lib/theme-tokens.ts`
- Test: `web/lib/theme-tokens.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Produces: `type ThemeName = "open" | "sealed"`, `type RgbaToken = [number, number, number, number]`, `THEME_TOKENS: Record<"bg"|"ink"|"inkSoft"|"line"|"fill"|"chapWarm"|"chapCool", Record<ThemeName, RgbaToken>>`, `rgbaCss(token: RgbaToken): string`, `cssVarsFor(theme: ThemeName): Record<string, string>` (keys: `--bg`, `--ink`, `--ink-soft`, `--line`, `--fill`, `--chap-warm`, `--chap-cool`).
- Consumed by: Task 2 (`theme.tsx`), Task 8 (`globals.css` defaults must match `cssVarsFor("sealed")` values by eye).

- [ ] **Step 1: Add the `tsx` devDependency and a `test` script**

Read `web/package.json`, then edit the `devDependencies` and `scripts` blocks:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test lib/*.test.ts"
  },
```

```json
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
```

Run: `cd "web" && pnpm install`
Expected: installs `tsx` into `web/node_modules` (or hoists at the workspace root), exits 0.

- [ ] **Step 2: Write the failing test**

Create `web/lib/theme-tokens.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_TOKENS, rgbaCss, cssVarsFor } from "./theme-tokens";

test("rgbaCss formats an RGBA token as a CSS rgba() string", () => {
  assert.equal(rgbaCss([5, 6, 10, 1]), "rgba(5,6,10,1)");
  assert.equal(rgbaCss([232, 227, 216, 0.6]), "rgba(232,227,216,0.6)");
});

test("every token has both an open and a sealed value", () => {
  for (const [name, pair] of Object.entries(THEME_TOKENS)) {
    assert.ok(pair.open, `${name}.open is missing`);
    assert.ok(pair.sealed, `${name}.sealed is missing`);
  }
});

test("cssVarsFor returns all seven CSS custom properties for a theme", () => {
  const vars = cssVarsFor("sealed");
  assert.deepEqual(Object.keys(vars).sort(), [
    "--bg",
    "--chap-cool",
    "--chap-warm",
    "--fill",
    "--ink",
    "--ink-soft",
    "--line",
  ]);
  assert.equal(vars["--bg"], "rgba(5,6,10,1)");
});

test("open and sealed themes produce different backgrounds", () => {
  const open = cssVarsFor("open");
  const sealed = cssVarsFor("sealed");
  assert.notEqual(open["--bg"], sealed["--bg"]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd "web" && pnpm test`
Expected: FAIL — `Cannot find module './theme-tokens'` (file doesn't exist yet).

- [ ] **Step 4: Write the implementation**

Create `web/lib/theme-tokens.ts`. These values are extracted directly from the color pairs already hardcoded in `web/components/CinematicHero.tsx`'s `paint()` method (the `rgba([...], [...], T, a1, a2)` calls for `--ink`, `--ink-soft`, `--line`, `--fill`, `--chap-warm`, `--chap-cool`, and the `stage.style.background` line for `--bg`) — first array/alpha = open, second = sealed:

```ts
export type ThemeName = "open" | "sealed";

export type RgbaToken = [number, number, number, number];

type TokenName =
  | "bg"
  | "ink"
  | "inkSoft"
  | "line"
  | "fill"
  | "chapWarm"
  | "chapCool";

export const THEME_TOKENS: Record<TokenName, Record<ThemeName, RgbaToken>> = {
  bg: { open: [243, 239, 230, 1], sealed: [5, 6, 10, 1] },
  ink: { open: [35, 32, 27, 1], sealed: [242, 239, 232, 1] },
  inkSoft: { open: [48, 44, 37, 0.66], sealed: [232, 227, 216, 0.6] },
  line: { open: [48, 44, 37, 0.26], sealed: [232, 227, 216, 0.28] },
  fill: { open: [255, 255, 255, 0.34], sealed: [255, 255, 255, 0.04] },
  chapWarm: { open: [150, 112, 40, 0.92], sealed: [214, 168, 96, 0.8] },
  chapCool: { open: [48, 88, 168, 0.9], sealed: [150, 184, 255, 0.84] },
};

export function rgbaCss(token: RgbaToken): string {
  const [r, g, b, a] = token;
  return `rgba(${r},${g},${b},${a})`;
}

export function cssVarsFor(theme: ThemeName): Record<string, string> {
  return {
    "--bg": rgbaCss(THEME_TOKENS.bg[theme]),
    "--ink": rgbaCss(THEME_TOKENS.ink[theme]),
    "--ink-soft": rgbaCss(THEME_TOKENS.inkSoft[theme]),
    "--line": rgbaCss(THEME_TOKENS.line[theme]),
    "--fill": rgbaCss(THEME_TOKENS.fill[theme]),
    "--chap-warm": rgbaCss(THEME_TOKENS.chapWarm[theme]),
    "--chap-cool": rgbaCss(THEME_TOKENS.chapCool[theme]),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd "web" && pnpm test`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 6: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/lib/theme-tokens.ts web/lib/theme-tokens.test.ts pnpm-lock.yaml
git commit -m "feat(web): add shared open/sealed theme tokens"
```

---

### Task 2: ThemeProvider + useTheme hook

**Files:**
- Create: `web/lib/theme.tsx`

**Interfaces:**
- Consumes: `cssVarsFor`, `ThemeName` from `web/lib/theme-tokens.ts` (Task 1).
- Produces: `ThemeProvider({ children }: { children: ReactNode })`, `useTheme(): { theme: ThemeName; toggleTheme: () => void }`.
- Consumed by: Task 3 (`SiteHeader`), Task 4 (`CinematicHero`, `app/page.tsx`).

This file is a `"use client"` component that reads/writes `localStorage` and mutates `document.documentElement` — not unit-testable without a DOM, and adding jsdom for one file violates the no-new-dependencies constraint. Verify it manually in the browser in Task 4, once `SiteHeader` and `CinematicHero` are both wired to it.

- [ ] **Step 1: Write the implementation**

Create `web/lib/theme.tsx`:

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cssVarsFor, type ThemeName } from "./theme-tokens";

const STORAGE_KEY = "hero-theme";

interface ThemeContextValue {
  theme: ThemeName;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeName {
  if (typeof window === "undefined") return "sealed";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "open" || saved === "sealed") return saved;
  } catch {
    // ignore (e.g. localStorage disabled)
  }
  return "sealed";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>("sealed");

  // Corrects from localStorage after mount so server and first client
  // render both use the "sealed" default — no hydration mismatch.
  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const vars = cssVarsFor(theme);
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === "sealed" ? "open" : "sealed")),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors. (This file isn't wired into the app yet, so no runtime check here — that happens in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add web/lib/theme.tsx
git commit -m "feat(web): add ThemeProvider and useTheme hook"
```

---

### Task 3: SiteHeader

**Files:**
- Create: `web/components/SiteHeader.tsx`
- Create: `web/components/SiteHeader.module.css`

**Interfaces:**
- Consumes: `useTheme()` from `web/lib/theme.tsx` (Task 2).
- Produces: default export `SiteHeader()` — no props.
- Consumed by: Task 4 (`app/page.tsx`).

- [ ] **Step 1: Write the component**

Create `web/components/SiteHeader.tsx`:

```tsx
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
```

- [ ] **Step 2: Write the styles**

Create `web/components/SiteHeader.module.css`:

```css
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: clamp(22px, 3.2vh, 34px) clamp(32px, 7vw, 132px);
}

.wordmark {
  font-family: var(--font-display);
  font-size: 21px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink, #f2efe8);
}

.nav {
  display: flex;
  align-items: center;
  gap: clamp(20px, 3vw, 44px);
  font-family: var(--font-body);
  font-weight: 300;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: var(--ink-soft, rgba(232, 227, 216, 0.6));
}

.navLink {
  transition: color 0.5s ease;
}
.navLink:hover {
  color: var(--ink, #f2efe8);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: clamp(8px, 1.6vw, 22px);
  cursor: pointer;
  user-select: none;
}

.toggleLabel {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--ink, #f2efe8);
  opacity: 0.42;
  transition: opacity 0.4s ease;
}
.toggleLabel[data-active="true"] {
  opacity: 1;
}

.rail {
  position: relative;
  display: block;
  width: 82px;
  height: 10px;
}
.rail::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--line, rgba(232, 227, 216, 0.28));
}

.knob {
  position: absolute;
  top: 1px;
  left: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink, #f2efe8);
  box-shadow: 0 0 6px rgba(96, 148, 255, 0.5);
  transform: translateX(0);
  transition: transform 0.4s ease, box-shadow 0.4s ease;
}
.knob[data-sealed="true"] {
  transform: translateX(74px);
  box-shadow: 0 0 16px rgba(96, 148, 255, 0.75);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors. (Not rendered anywhere yet — wired in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add web/components/SiteHeader.tsx web/components/SiteHeader.module.css
git commit -m "feat(web): add SiteHeader with the open/sealed toggle"
```

---

### Task 4: Wire the theme system into the page (ThemeProvider + SiteHeader + CinematicHero)

This is the one task that touches `CinematicHero.tsx` and must be done as a unit — `SiteHeader`'s toggle and `CinematicHero`'s theme-driven paint loop can only be verified together, once both read from the same `ThemeProvider`.

**Files:**
- Modify: `web/components/CinematicHero.tsx`
- Modify: `web/components/CinematicHero.module.css`
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: `ThemeProvider`, `useTheme` (Task 2); `SiteHeader` (Task 3).
- Produces: `CinematicHero` no longer accepts a `startTheme` prop (removed — theme now comes from context).

- [ ] **Step 1: Add the `useTheme` import to `CinematicHero.tsx`**

Read `web/components/CinematicHero.tsx`, then add near the top (after the `styles` import):

```tsx
import styles from "./CinematicHero.module.css";
import { useTheme } from "@/lib/theme";
```

- [ ] **Step 2: Drop the `startTheme` prop**

Find:

```tsx
export interface CinematicHeroProps {
  /** total scroll travel driving the scene, in vh */
  scrollDepth?: number;
  /** parallax blur softness, in px */
  softness?: number;
  /** bloom glow strength */
  bloomIntensity?: number;
  /** which theme the scene opens in */
  startTheme?: "open" | "sealed";
}

export default function CinematicHero({
  scrollDepth = 340,
  softness = 14,
  bloomIntensity = 1,
  startTheme = "sealed",
}: CinematicHeroProps) {
```

Replace with:

```tsx
export interface CinematicHeroProps {
  /** total scroll travel driving the scene, in vh */
  scrollDepth?: number;
  /** parallax blur softness, in px */
  softness?: number;
  /** bloom glow strength */
  bloomIntensity?: number;
}

export default function CinematicHero({
  scrollDepth = 340,
  softness = 14,
  bloomIntensity = 1,
}: CinematicHeroProps) {
  const { theme } = useTheme();
```

- [ ] **Step 3: Remove the now-unused `knob`/`labOpen`/`labSealed` refs**

Find:

```tsx
  const knob = useRef<HTMLSpanElement>(null);
  const labOpen = useRef<HTMLSpanElement>(null);
  const labSealed = useRef<HTMLSpanElement>(null);
  const emph = useRef<HTMLElement>(null);
```

Replace with:

```tsx
  const emph = useRef<HTMLElement>(null);
```

- [ ] **Step 4: Remove the localStorage-based theme init from the mount effect**

Find:

```tsx
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("hero-theme");
    } catch {
      // ignore
    }
    const startDark = saved === null ? startTheme !== "open" : saved === "sealed";
    a.theme = a.themeTarget = startDark ? 1 : 0;

    if (grain.current) {
```

Replace with:

```tsx
    if (grain.current) {
```

(`anim.current` already initializes `theme: 1, themeTarget: 1`, matching `ThemeProvider`'s "sealed" default — Step 6 below keeps them in sync as context changes.)

- [ ] **Step 5: Remove `toggleTheme`**

Find:

```tsx
  const toggleTheme = () => {
    const a = anim.current;
    a.themeTarget = a.themeTarget > 0.5 ? 0 : 1;
    try {
      localStorage.setItem("hero-theme", a.themeTarget > 0.5 ? "sealed" : "open");
    } catch {
      // ignore
    }
  };

```

Delete it entirely (the toggle now lives in `SiteHeader` and calls the context's `toggleTheme` directly).

- [ ] **Step 6: Add an effect that syncs the context theme into the animation loop**

Find the end of the mount `useEffect` (the `return () => { cancelAnimationFrame(...) }` block and its closing `}, []);`):

```tsx
    return () => {
      cancelAnimationFrame(a.raf);
      window.removeEventListener("pointermove", onMove);
    };
    // scrollDepth/softness/bloomIntensity/startTheme are read once on mount, matching the
    // original scroll-driven scene which never re-initializes on prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Replace with (fixes the stale comment and adds the new effect right after):

```tsx
    return () => {
      cancelAnimationFrame(a.raf);
      window.removeEventListener("pointermove", onMove);
    };
    // scrollDepth/softness/bloomIntensity are read once on mount, matching the
    // original scroll-driven scene which never re-initializes on prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    anim.current.themeTarget = theme === "sealed" ? 1 : 0;
  }, [theme]);
```

- [ ] **Step 7: Remove the knob/label painting from `paint()`**

Find:

```tsx
      if (knob.current) {
        knob.current.style.transform = "translateX(" + (T * 74).toFixed(2) + "px)";
        knob.current.style.boxShadow = "0 0 " + (6 + 10 * T).toFixed(1) + "px " + rgba([190, 150, 70], [96, 148, 255], T, 0.5, 0.75);
        knob.current.style.background = rgba([60, 52, 38], [242, 239, 232], T, 1, 1);
      }
      if (labOpen.current) labOpen.current.style.opacity = mix(1, 0.42, T).toFixed(3);
      if (labSealed.current) labSealed.current.style.opacity = mix(0.42, 1, T).toFixed(3);

      cap(cap0, 1 - band(p, 0.1, 0.26));
```

Replace with:

```tsx
      cap(cap0, 1 - band(p, 0.1, 0.26));
```

- [ ] **Step 8: Remove the top nav JSX block**

Find (the block between the grain `<div>` and the headline grid `<div>`):

```tsx
        <div ref={grain} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.05, mixBlendMode: "overlay" }} />

        <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32, padding: "clamp(22px, 3.2vh, 34px) clamp(32px, 7vw, 132px)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 21, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--ink, #f2efe8)" }}>Sealed</div>
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(20px, 3vw, 44px)", fontFamily: "var(--font-body)", fontWeight: 300, fontSize: 13, letterSpacing: ".1em", color: "var(--ink-soft, rgba(232,227,216,.6))" }}>
            <a href="#" className={styles.navLink}>Thesis</a>
            <a href="#" className={styles.navLink}>Architecture</a>
            <a href="#" className={styles.navLink}>Verify</a>
            <div onClick={toggleTheme} role="button" tabIndex={0} style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: "clamp(8px, 1.6vw, 22px)", cursor: "pointer", userSelect: "none" }}>
              <span ref={labOpen} style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: ".3em", textTransform: "uppercase", color: "var(--ink, #f2efe8)" }}>Open</span>
              <span style={{ position: "relative", display: "block", width: 82, height: 10 }}>
                <span style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "var(--line, rgba(232,227,216,.28))" }} />
                <span ref={knob} style={{ position: "absolute", top: 1, left: 0, width: 8, height: 8, borderRadius: "50%", background: "var(--ink, #f2efe8)", willChange: "transform, box-shadow" }} />
              </span>
              <span ref={labSealed} style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: ".3em", textTransform: "uppercase", color: "var(--ink, #f2efe8)" }}>Sealed</span>
            </div>
          </div>
        </div>

        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", alignItems: "center", padding: "0 clamp(32px, 7vw, 132px)" }}>
```

Replace with:

```tsx
        <div ref={grain} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.05, mixBlendMode: "overlay" }} />

        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", alignItems: "center", padding: "0 clamp(32px, 7vw, 132px)" }}>
```

- [ ] **Step 9: Remove the now-unused `.navLink` rule from `CinematicHero.module.css`**

Read `web/components/CinematicHero.module.css`, remove:

```css
.navLink {
  transition: color 0.5s ease;
}
.navLink:hover {
  color: var(--ink, #f2efe8);
}
```

(Keep `.cta` and `.watch` — still used by the hero's own "Explore the demo" / "Read the spec" links.)

- [ ] **Step 10: Wrap the page in `ThemeProvider` and add `SiteHeader`**

Read `web/app/page.tsx`, replace its contents:

```tsx
import CinematicHero from "@/components/CinematicHero";
import SiteHeader from "@/components/SiteHeader";
import { ThemeProvider } from "@/lib/theme";

export default function Home() {
  return (
    <ThemeProvider>
      <SiteHeader />
      <CinematicHero />
    </ThemeProvider>
  );
}
```

- [ ] **Step 11: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Build and manually verify in the browser**

Run: `cd "web" && npx next build`
Expected: builds successfully.

Run: `cd "web" && npx next dev -p 3411 &` then wait ~3s, then:
`curl -s http://localhost:3411/ | grep -o 'Toggle open/sealed theme'`
Expected: prints the match (confirms `SiteHeader` rendered).

Then open `http://localhost:3411` in a browser:
- Confirm the hero looks and animates exactly as before (scroll parallax, no visual regression).
- Confirm the fixed header is visible at the top with the wordmark, 4 nav links, and the Open/Sealed toggle.
- Click the toggle: confirm the hero's whole scene crossfades between the light and dark palette (same as before) and the header's knob slides across the rail.
- Reload the page: confirm the theme you left it on persists (reads from `localStorage`).

Stop the dev server: `kill %1` (or `pkill -f "next dev -p 3411"`).

- [ ] **Step 13: Commit**

```bash
git add web/components/CinematicHero.tsx web/components/CinematicHero.module.css web/app/page.tsx
git commit -m "feat(web): wire CinematicHero and SiteHeader into a shared ThemeProvider"
```

---

### Task 5: `globals.css` — root theme defaults + shared `.section` utility

**Files:**
- Modify: `web/app/globals.css`

**Interfaces:**
- Produces: global `.section` class (background/color/transition/scroll-margin) and `:root` default values for `--bg`, `--ink`, `--ink-soft`, `--line`, `--fill`, `--chap-warm`, `--chap-cool` — consumed by every section component in Tasks 6–10.

- [ ] **Step 1: Add the root defaults and `.section` utility**

Read `web/app/globals.css`, add after the existing `html, body { ... }` block:

```css
:root {
  --bg: rgba(5, 6, 10, 1);
  --ink: rgba(242, 239, 232, 1);
  --ink-soft: rgba(232, 227, 216, 0.6);
  --line: rgba(232, 227, 216, 0.28);
  --fill: rgba(255, 255, 255, 0.04);
  --chap-warm: rgba(214, 168, 96, 0.8);
  --chap-cool: rgba(150, 184, 255, 0.84);
}

.section {
  background: var(--bg);
  color: var(--ink);
  transition:
    background-color 0.6s ease,
    color 0.6s ease;
  scroll-margin-top: 100px;
}
```

These match `cssVarsFor("sealed")` from `web/lib/theme-tokens.ts` (Task 1) — the same default `ThemeProvider` uses before it corrects from `localStorage`, so there's no flash of mismatched color on first paint.

- [ ] **Step 2: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors (CSS-only change, this just confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add web/app/globals.css
git commit -m "chore(web): add root theme defaults and shared .section utility"
```

---

### Task 6: ThesisSection

**Files:**
- Create: `web/components/ThesisSection.tsx`
- Create: `web/components/ThesisSection.module.css`

**Interfaces:**
- Produces: default export `ThesisSection()` — no props, renders `<section id="thesis">`.
- Consumed by: Task 11 (`app/page.tsx` assembly).

- [ ] **Step 1: Write the component**

Create `web/components/ThesisSection.tsx`:

```tsx
import styles from "./ThesisSection.module.css";

export default function ThesisSection() {
  return (
    <section id="thesis" className={`section ${styles.thesis}`}>
      <div className={styles.inner}>
        <div className={styles.eyebrow}>The problem</div>
        <p className={styles.lead}>
          Payment, execution and reputation are each solved for agents, but
          nothing connects them.
        </p>
        <p className={styles.body}>
          We carry one signed intent hash from payment, through the enclave,
          to reputation — <em>intent-bound verification</em>.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write the styles**

Create `web/components/ThesisSection.module.css`:

```css
.thesis {
  display: flex;
  justify-content: center;
  padding: clamp(96px, 16vh, 200px) clamp(32px, 7vw, 132px);
}

.inner {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--chap-warm);
}

.lead {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 300;
  font-size: clamp(30px, 3.4vw, 48px);
  line-height: 1.25;
  letter-spacing: -0.01em;
}

.body {
  margin: 0;
  font-family: var(--font-body);
  font-weight: 200;
  font-size: 18px;
  line-height: 1.75;
  color: var(--ink-soft);
}

.body em {
  font-style: italic;
  color: var(--ink);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/ThesisSection.tsx web/components/ThesisSection.module.css
git commit -m "feat(web): add Thesis section"
```

---

### Task 7: HowItWorksSection

**Files:**
- Create: `web/components/HowItWorksSection.tsx`
- Create: `web/components/HowItWorksSection.module.css`

**Interfaces:**
- Produces: default export `HowItWorksSection()` — no props, renders `<section id="how-it-works">`.
- Consumed by: Task 11.

- [ ] **Step 1: Write the component**

Create `web/components/HowItWorksSection.tsx`:

```tsx
import styles from "./HowItWorksSection.module.css";

const STEPS = [
  {
    n: "01",
    title: "Discover",
    body: "Alice finds Bob through the public ERC-8004 registry — skill, endpoint, and encryption pubkey, no prior relationship required.",
  },
  {
    n: "02",
    title: "Encrypt & pay",
    body: "The brief and data are ECIES-encrypted to Bob's pubkey; Alice signs an EIP-712 intent hash and pays over x402.",
  },
  {
    n: "03",
    title: "Verify",
    body: "Bob's Tapp recomputes the intent hash inside a TEE, calls 0G Sealed Inference, and signs the match. Verifier.sol checks both signatures before settlement releases.",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className={`section ${styles.section}`}>
      <div className={styles.eyebrow}>How it works</div>
      <ol className={styles.steps}>
        {STEPS.map((step) => (
          <li key={step.n} className={styles.step}>
            <span className={styles.number}>{step.n}</span>
            <h3 className={styles.title}>{step.title}</h3>
            <p className={styles.body}>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 2: Write the styles**

Create `web/components/HowItWorksSection.module.css`:

```css
.section {
  padding: clamp(96px, 16vh, 200px) clamp(32px, 7vw, 132px);
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--chap-cool);
  margin-bottom: 48px;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 48px;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.number {
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.2em;
  color: var(--chap-warm);
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 26px;
  color: var(--ink);
}

.body {
  margin: 0;
  font-family: var(--font-body);
  font-weight: 200;
  font-size: 15px;
  line-height: 1.7;
  color: var(--ink-soft);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/HowItWorksSection.tsx web/components/HowItWorksSection.module.css
git commit -m "feat(web): add How it works section"
```

---

### Task 8: ArchitectureSection

**Files:**
- Create: `web/components/ArchitectureSection.tsx`
- Create: `web/components/ArchitectureSection.module.css`

**Interfaces:**
- Produces: default export `ArchitectureSection()` — no props, renders `<section id="architecture">`.
- Consumed by: Task 11.

- [ ] **Step 1: Write the component**

Create `web/components/ArchitectureSection.tsx`:

```tsx
import styles from "./ArchitectureSection.module.css";

const NODES = [
  { label: "Alice-agent", detail: "discovers · signs intent · pays" },
  { label: "Bob's Tapp (TEE #1)", detail: "recomputes hash · checks match" },
  { label: "0G Sealed Inference (TEE #2)", detail: "runs the model" },
  { label: "Verifier.sol", detail: "checks both signatures on-chain" },
];

export default function ArchitectureSection() {
  return (
    <section id="architecture" className={`section ${styles.section}`}>
      <div className={styles.eyebrow}>Architecture</div>
      <div className={styles.diagram}>
        {NODES.map((node, i) => (
          <div className={styles.nodeWrap} key={node.label}>
            <div className={styles.node}>
              <div className={styles.nodeLabel}>{node.label}</div>
              <div className={styles.nodeDetail}>{node.detail}</div>
            </div>
            {i < NODES.length - 1 && (
              <div className={styles.arrow} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      <p className={styles.legend}>
        Base = the verdict · Hedera = the timeline · The Graph = the read
        layer · 0G = the compute.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Write the styles**

Create `web/components/ArchitectureSection.module.css`:

```css
.section {
  padding: clamp(96px, 16vh, 200px) clamp(32px, 7vw, 132px);
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--chap-warm);
  margin-bottom: 48px;
}

.diagram {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
}

.nodeWrap {
  display: flex;
  align-items: center;
}

.node {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px 22px;
  min-width: 180px;
  background: var(--fill);
}

.nodeLabel {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--ink);
  margin-bottom: 8px;
}

.nodeDetail {
  font-family: var(--font-body);
  font-weight: 200;
  font-size: 13px;
  color: var(--ink-soft);
}

.arrow {
  width: clamp(24px, 3vw, 48px);
  height: 1px;
  margin: 0 8px;
  background: linear-gradient(90deg, var(--chap-warm), var(--chap-cool));
  position: relative;
}
.arrow::after {
  content: "";
  position: absolute;
  right: 0;
  top: 50%;
  width: 6px;
  height: 6px;
  border-top: 1px solid var(--chap-cool);
  border-right: 1px solid var(--chap-cool);
  transform: translateY(-50%) rotate(45deg);
}

@media (max-width: 860px) {
  .diagram {
    flex-direction: column;
    align-items: flex-start;
  }
  .nodeWrap {
    flex-direction: column;
    align-items: flex-start;
  }
  .arrow {
    width: 1px;
    height: 24px;
    margin: 8px 0 8px 20px;
  }
  .arrow::after {
    right: auto;
    left: 50%;
    top: auto;
    bottom: 0;
    transform: translateX(-50%) rotate(135deg);
  }
}

.legend {
  margin: 40px 0 0;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--ink-soft);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/ArchitectureSection.tsx web/components/ArchitectureSection.module.css
git commit -m "feat(web): add Architecture section with box-and-arrow diagram"
```

---

### Task 9: TracksSection

**Files:**
- Create: `web/components/TracksSection.tsx`
- Create: `web/components/TracksSection.module.css`

**Interfaces:**
- Produces: default export `TracksSection()` — no props, renders `<section id="tracks">`.
- Consumed by: Task 11.

- [ ] **Step 1: Write the component**

Create `web/components/TracksSection.tsx`:

```tsx
import styles from "./TracksSection.module.css";

const TRACKS = [
  {
    name: "0G",
    detail:
      "Sealed Inference — the model runs inside a TeeML TEE via @0gfoundation/0g-compute-ts-sdk; output is signed by the enclave.",
  },
  {
    name: "The Graph",
    detail:
      "ERC-8004 registry index + JobVerified verified-delivery count, forked from the agent0lab subgraph and deployed live to Subgraph Studio.",
  },
  {
    name: "Hedera",
    detail:
      "@x402/hedera exact-scheme payment via the blocky402 testnet facilitator, settled after verification; HCS records the off-chain timeline as commitments.",
  },
];

export default function TracksSection() {
  return (
    <section id="tracks" className={`section ${styles.section}`}>
      <div className={styles.eyebrow}>Tracks</div>
      <div className={styles.cards}>
        {TRACKS.map((track) => (
          <div className={styles.card} key={track.name}>
            <div className={styles.cardTitle}>{track.name}</div>
            <p className={styles.cardBody}>{track.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write the styles**

Create `web/components/TracksSection.module.css`:

```css
.section {
  padding: clamp(96px, 16vh, 200px) clamp(32px, 7vw, 132px);
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--chap-cool);
  margin-bottom: 48px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 32px;
}

.card {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 28px;
  background: var(--fill);
}

.cardTitle {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 22px;
  color: var(--ink);
  margin-bottom: 12px;
}

.cardBody {
  margin: 0;
  font-family: var(--font-body);
  font-weight: 200;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink-soft);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/TracksSection.tsx web/components/TracksSection.module.css
git commit -m "feat(web): add Tracks section"
```

---

### Task 10: FraudDemoTeaser + CtaFooter

**Files:**
- Create: `web/components/FraudDemoTeaser.tsx`
- Create: `web/components/FraudDemoTeaser.module.css`
- Create: `web/components/CtaFooter.tsx`
- Create: `web/components/CtaFooter.module.css`

**Interfaces:**
- Produces: default exports `FraudDemoTeaser()` and `CtaFooter()` — no props.
- Consumed by: Task 11.

- [ ] **Step 1: Write FraudDemoTeaser**

Create `web/components/FraudDemoTeaser.tsx`:

```tsx
import styles from "./FraudDemoTeaser.module.css";

export default function FraudDemoTeaser() {
  return (
    <section className={`section ${styles.section}`}>
      <div className={styles.frame}>
        <span className={styles.tag}>Coming soon</span>
        <p className={styles.body}>
          A single flag makes Bob answer a different job. The contract
          catches the mismatch and rejects it — live, on-chain.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write its styles**

Create `web/components/FraudDemoTeaser.module.css`:

```css
.section {
  display: flex;
  justify-content: center;
  padding: clamp(64px, 10vh, 140px) clamp(32px, 7vw, 132px);
}

.frame {
  max-width: 560px;
  width: 100%;
  border: 1px dashed var(--line);
  border-radius: 16px;
  padding: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  text-align: center;
}

.tag {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--chap-cool);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 14px;
}

.body {
  margin: 0;
  font-family: var(--font-body);
  font-weight: 200;
  font-size: 16px;
  line-height: 1.7;
  color: var(--ink-soft);
}
```

- [ ] **Step 3: Write CtaFooter**

Create `web/components/CtaFooter.tsx`:

```tsx
import styles from "./CtaFooter.module.css";

export default function CtaFooter() {
  return (
    <footer className={`section ${styles.footer}`}>
      <div className={styles.ctas}>
        <a href="#" className={styles.primary}>
          Explore the repo
        </a>
      </div>
      <p className={styles.boundaries}>
        This is feedback anchored to paid, verified jobs — not Sybil-proof
        reputation. The binding catches task substitution and input
        tampering, not all prompt injection. Signatures are verified
        on-chain; enclave attestation is checked off-chain at setup.
      </p>
      <div className={styles.marks}>0G · The Graph · Hedera</div>
    </footer>
  );
}
```

- [ ] **Step 4: Write its styles**

Create `web/components/CtaFooter.module.css`:

```css
.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  padding: clamp(64px, 10vh, 140px) clamp(32px, 7vw, 132px) clamp(48px, 8vh, 100px);
  text-align: center;
}

.ctas {
  display: flex;
  gap: 20px;
}

.primary {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 15px 30px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-family: var(--font-body);
  font-weight: 300;
  font-size: 14px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink);
  background: var(--fill);
  transition: border-color 0.5s ease, letter-spacing 0.5s ease;
}
.primary:hover {
  border-color: var(--ink);
  letter-spacing: 0.14em;
}

.boundaries {
  max-width: 560px;
  margin: 0;
  font-family: var(--font-body);
  font-weight: 200;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-soft);
}

.marks {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--ink-soft);
}
```

- [ ] **Step 5: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/FraudDemoTeaser.tsx web/components/FraudDemoTeaser.module.css web/components/CtaFooter.tsx web/components/CtaFooter.module.css
git commit -m "feat(web): add fraud demo teaser and CTA/footer sections"
```

---

### Task 11: Assemble the full page and verify end-to-end

**Files:**
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: every component produced in Tasks 3–10.

- [ ] **Step 1: Assemble the page**

Read `web/app/page.tsx`, replace its contents:

```tsx
import CinematicHero from "@/components/CinematicHero";
import SiteHeader from "@/components/SiteHeader";
import ThesisSection from "@/components/ThesisSection";
import HowItWorksSection from "@/components/HowItWorksSection";
import ArchitectureSection from "@/components/ArchitectureSection";
import TracksSection from "@/components/TracksSection";
import FraudDemoTeaser from "@/components/FraudDemoTeaser";
import CtaFooter from "@/components/CtaFooter";
import { ThemeProvider } from "@/lib/theme";

export default function Home() {
  return (
    <ThemeProvider>
      <SiteHeader />
      <CinematicHero />
      <ThesisSection />
      <HowItWorksSection />
      <ArchitectureSection />
      <TracksSection />
      <FraudDemoTeaser />
      <CtaFooter />
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "web" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the unit tests**

Run: `cd "web" && pnpm test`
Expected: PASS — 4 tests, 0 failures (unchanged from Task 1).

- [ ] **Step 4: Build**

Run: `cd "web" && npx next build`
Expected: builds successfully, all routes static.

- [ ] **Step 5: Smoke-test every section renders with the right anchor**

Run: `cd "web" && npx next dev -p 3411 &` then wait ~3s, then:

```bash
for id in thesis how-it-works architecture tracks; do
  echo -n "#$id -> "
  curl -s http://localhost:3411/ | grep -c "id=\"$id\""
done
```

Expected: each line prints `1`.

```bash
curl -s http://localhost:3411/ | grep -o 'Explore the repo\|Coming soon\|Verifier.sol\|The Graph'
```

Expected: all four strings present in the output.

Stop the dev server: `kill %1` (or `pkill -f "next dev -p 3411"`).

- [ ] **Step 6: Manual browser pass**

Open `http://localhost:3411` (start the dev server again if you stopped it) and:
- Scroll through the whole page top to bottom — confirm no layout breaks, no section overlapping the fixed header oddly, no unstyled flash.
- Click each header nav link (`Thesis`, `How it works`, `Architecture`, `Tracks`) — confirm it scrolls to the matching section without hiding its heading behind the fixed header.
- Toggle Open/Sealed from the header — confirm every section's background/text color crossfades along with the hero.
- Resize the browser to ~375px wide — confirm the Architecture diagram stacks vertically and nothing overflows horizontally.

- [ ] **Step 7: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat(web): assemble the full landing page"
```

---

## Self-Review Notes

- **Spec coverage:** theme system → Tasks 1–2; persistent header → Task 3; hero wiring → Task 4; `.section`/root defaults → Task 5; Thesis/How it works/Architecture/Tracks/Fraud teaser/CTA-Footer → Tasks 6–10; final assembly + verification → Task 11. All six spec sections and both cross-cutting systems (theme, header) are covered.
- **Placeholder scan:** no TBD/TODO left in any step; the `href="#"` in `CtaFooter` is an intentional, spec-approved placeholder (documented in the design spec's "Out of scope" reasoning), not an unfinished plan step.
- **Type consistency:** `ThemeName`, `cssVarsFor`, `useTheme` signatures are identical everywhere they're consumed (Tasks 2–4). `THEME_TOKENS` keys (`bg`, `ink`, `inkSoft`, `line`, `fill`, `chapWarm`, `chapCool`) map 1:1 to the CSS custom properties (`--bg`, `--ink`, `--ink-soft`, `--line`, `--fill`, `--chap-warm`, `--chap-cool`) used identically across `theme-tokens.ts`, `globals.css`, and every section's CSS module.
