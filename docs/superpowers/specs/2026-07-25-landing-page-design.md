# Landing page — design spec

Date: 2026-07-25
Branch: `landing-page`
Status: approved by user, not yet implemented (beyond the hero)

## Context

The Cinematic Hero section (`web/components/CinematicHero.tsx`) is implemented and
verified — a scroll-driven, parallax, light/dark theme-crossfade hero ported from a
Claude Design HTML/CSS/JS export. This spec covers everything below the hero: the
remaining landing page sections, a shared theme system, and a persistent header.

Audience: layered. The page opens editorial/vision-first (readable by anyone) and gets
progressively more technical as the user scrolls, so it works for both a casual visitor
and an ETHGlobal Lisbon judge deciding whether to dig into the architecture.

Project facts this page must stay honest to (see root `CLAUDE.md` §11 "Honest
boundaries"): as of this branch, only Phase 0 spikes are green (0G Sealed Inference,
Tapp binding path, Hedera x402, ERC-8004 register/read). The demo-dApp
(`web/app/dashboard`) does not exist yet. The landing page must not claim a working
demo exists.

## Theme system

The hero already supports a full light↔dark crossfade (not just a tint): at theme=open
the stage background moves toward near-white (`rgb(243,239,230)`) with dark ink; at
theme=sealed it moves toward near-black (`#05060a`) with light ink. The rest of the
page reuses this exact token set so toggling the theme changes the whole page, not just
the hero.

- `web/lib/theme-tokens.ts` — the color-pair constants (`ink`, `ink-soft`, `line`,
  `fill`, `chap-warm`, `chap-cool`, `bg`) as `{ open: [r,g,b,a], sealed: [r,g,b,a] }`
  pairs, extracted from `CinematicHero.tsx`'s inline `rgba(...)` calls so there is one
  source of truth instead of two copies of the same colors.
- `web/lib/theme.tsx` — `ThemeProvider` (React context) holding `theme: 'open' |
  'sealed'` and `toggleTheme()`, persisted to `localStorage['hero-theme']` (same key
  the hero already uses). On theme change, sets `data-theme` on `<html>` and writes the
  token pairs as CSS custom properties (`--bg`, `--ink`, `--ink-soft`, `--line`,
  `--fill`, `--chap-warm`, `--chap-cool`) at the `:root` level, using flat (non-animated)
  values — the hero keeps its own eased crossfade internally for its own layers, but the
  page-level CSS vars just snap/transition via a plain CSS `transition`.
- `CinematicHero.tsx` stops owning theme state locally: its `toggleTheme` and the
  `theme`/`themeTarget` animation-ref fields read their target from `ThemeProvider`
  instead of local component state. The hero's internal easing/paint loop (`anim.theme`
  chasing `anim.themeTarget`) is unchanged — it still animates its own layers smoothly;
  it just takes its target from context instead of owning it.
- Every section below the hero uses `var(--bg)` / `var(--ink)` / `var(--ink-soft)` /
  `var(--line)` instead of hardcoded colors, with `transition: background-color .6s
  ease, color .6s ease` for a soft (non-parallax) crossfade — deliberately simpler than
  the hero's per-layer animation, since these are static content sections, not scroll
  scenes.

## Persistent header

`web/components/SiteHeader.tsx` — replaces the hero's own top nav (which only stays
sticky within the hero's own `340vh` scroll wrapper and disappears once the user scrolls
past it). The header is `position: fixed`, spans the full page, and is always visible:

- Left: `Sealed` wordmark (same styling as the hero's current corner logo).
- Center/right: anchor links `Thesis` / `How it works` / `Architecture` / `Tracks`,
  scrolling to each section's `id`.
- Far right: the Open/Sealed toggle — visually the same knob-on-a-rail control
  currently inside the hero, now reading/writing `ThemeProvider` — rendered once, here,
  not duplicated in the hero.

The hero's own top nav bar (`Sealed` wordmark + Thesis/Architecture/Verify links +
toggle, currently inline in `CinematicHero.tsx`) is removed since `SiteHeader` replaces
it. The hero keeps its own chapter captions, scroll rail, and "Scroll" hint — those are
scroll-scene furniture, not navigation, and stay put.

## Section order (`web/app/page.tsx`)

1. **Hero** (existing, unchanged except for the theme-context wiring and nav removal above)
2. **Thesis** (`#thesis`) — one editorial block. States the problem ("payment,
   execution and reputation are each solved for agents, but nothing connects them") and
   the answer (one signed intent hash carried from payment, through the enclave, to
   reputation). Typography: Cormorant Garamond heading, Jost body, on `var(--bg)`.
3. **How it works** (`#how-it-works`) — three-step flow, Alice → Bob: *discover* (ERC-8004
   registry) → *encrypt & pay* (ECIES + x402) → *verify* (Tapp match check +
   on-chain settlement). Each step: a mono-caps number/label (matching the hero's
   `IBM Plex Mono` chapter-caption style) + one short sentence. No claim of a working
   demo — this describes the designed flow.
4. **Architecture** (`#architecture`) — a stylized box-and-arrow diagram (CSS/SVG, not
   raw ASCII) reproducing `CLAUDE.md` §2's Level 1 diagram: Alice-agent → Bob's Tapp
   (TEE #1) → 0G Sealed Inference (TEE #2) → `Verifier.sol`. Below it, one line: "Base =
   the verdict · Hedera = the timeline · The Graph = the read layer · 0G = the compute."
   Mono labels, gold/blue accent lines consistent with the hero's chapter-warm/cool
   tokens.
5. **Tracks** (`#tracks`) — three cards: 0G, The Graph, Hedera. Each names the specific
   SDK/service actually used per `CLAUDE.md` §4 (e.g. 0G: Sealed Inference / TeeML
   broker; Hedera: `@x402/hedera` + blocky402 facilitator + HCS timeline; The Graph:
   ERC-8004 registry index + `JobVerified` verified-delivery count), one line each — no
   overclaiming beyond what's actually wired.
6. **Fraud demo teaser** — a static placeholder card (not an interactive/fake demo)
   describing the live on-chain fraud-rejection panel that Phase 3 will ship, labeled
   "coming soon". Exists to signal the differentiator without pretending it's live yet.
7. **CTA / Footer** — links to the GitHub repo (placeholder anchor until a public repo
   URL is confirmed) and a short "honest boundaries" note that mirrors `CLAUDE.md` §11
   (what this is *not* claiming), plus small track/sponsor marks (0G / Graph / Hedera).

All in-page CTAs and anchors point to `#`-anchors on this same page or the repo — none
point at a live demo, since one doesn't exist yet on this branch. When the demo-dApp
ships, the CTA hrefs are the only thing that needs to change.

## Out of scope for this spec

- The demo-dApp itself (`web/app/dashboard`) — separate phase, separate spec.
- Any backend/contract wiring — this is presentation-only, static content.
- Mobile-specific layout pass — sections should be responsive via the same `clamp()`
  patterns the hero already uses, but a dedicated mobile design pass is not part of this
  spec.
