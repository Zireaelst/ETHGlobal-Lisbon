// One-shot generator: reads the sponsor SVGs and emits SponsorLogo.tsx.
// The point is that no path data is ever retyped by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "sponsor-logos");
const OUT = join(ROOT, "web/src/components/SponsorLogo.tsx");

const read = (f) => readFileSync(`${SRC}/${f}`, "utf8");

/** Everything between <svg ...> and </svg>, comments and XML decl stripped. */
function inner(svg) {
  return svg
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>[\s\S]*$/, "")
    .trim();
}

/** SVG attribute names JSX insists on seeing in camelCase. */
function jsxAttrs(markup) {
  return markup
    .replace(/\bfill-rule=/g, "fillRule=")
    .replace(/\bclip-rule=/g, "clipRule=")
    .replace(/\bstroke-width=/g, "strokeWidth=")
    .replace(/\bstroke-linecap=/g, "strokeLinecap=")
    .replace(/\bstroke-linejoin=/g, "strokeLinejoin=")
    .replace(/\bstroke-miterlimit=/g, "strokeMiterlimit=")
    .replace(/\bdata-name="[^"]*"/g, "")
    .replace(/\bclass="cls-1"/g, "className={styles.brand}");
}

function indent(markup, pad) {
  return markup
    .split("\n")
    .map((l) => (l.trim() ? pad + l : ""))
    .filter(Boolean)
    .join("\n");
}

// --- 0G -------------------------------------------------------------------
// The source is a 500x500 export with an opaque white <rect> behind the mark —
// harmless on a white page, a white slab on the sealed theme. It goes, and the
// viewBox is cropped to the mark's own bounding box so 0G sits on the same
// optical baseline as the three wide lockups.
let og = inner(read("0G 500x500.svg"))
  .replace(/<rect[^>]*fill="white"[^>]*\/>/g, "")
  .replace(/fill="#9200E1"/g, 'fill="currentColor" className={styles.brand}');

// --- Base -----------------------------------------------------------------
// The 2-colour lockup: an unfilled wordmark (black by default) plus the square,
// which is the only part carrying Base blue. Only the square gets .brand.
let base = inner(read("Base_lockup_2color.svg"))
  .replace(/<defs>[\s\S]*?<\/defs>/g, "")
  .replace(/<path d=/g, '<path fill="currentColor" d=');

// --- Hedera ---------------------------------------------------------------
// Every shape is unfilled (i.e. black); fill="currentColor" on the root carries
// to all of them. Monochrome by origin — there is no brand colour to reveal.
let hedera = inner(read("Hedera-Logo-Lockup-Dark.svg"));

// --- The Graph ------------------------------------------------------------
// A single path, near-black. Also monochrome by origin.
let graph = inner(read("The Graph - Logo - Dark.svg")).replace(/fill="#0C0A1D"/g, 'fill="currentColor"');

for (const [name, m] of Object.entries({ og, base, hedera, graph })) {
  if (!m.includes("<path") && !m.includes("<polygon")) throw new Error(`${name}: extracted nothing`);
  if (/#[0-9a-fA-F]{3,8}|fill="white"|fill: *blue/.test(m.replace(/#9200E1/g, "")))
    throw new Error(`${name}: a hardcoded colour survived:\n${m.match(/#[0-9a-fA-F]{3,8}|fill: *blue/)}`);
}

const file = `// Client-side not because it needs state, but because it carries a CSS module and
// is pulled into the statically prerendered landing page — as a Server Component the
// module's stylesheet fails to resolve at export time. Every other CSS module in this
// app sits behind "use client" for the same reason.
"use client";

import type { CSSProperties, ReactNode } from "react";
import styles from "./SponsorLogo.module.css";

/**
 * The four sponsor lockups, inlined so they can take the page's ink colour.
 *
 * GENERATED from /sponsor-logos by scripts/gen-sponsor-logos.mjs — the geometry is
 * the sponsors' own, untouched. Two edits were made and both are structural, not
 * cosmetic: 0G's export carried an opaque white background rect (a white slab on
 * the sealed theme) and its viewBox is cropped to the mark so it shares an optical
 * baseline with the three wide lockups.
 *
 * Colour: every mark renders in \`currentColor\`, so it reads as page ink in both
 * themes rather than as four pasted logos. On hover it lifts to full-strength ink,
 * and the two marks that actually ship a brand colour — 0G's purple, Base's blue
 * square — take theirs back. Hedera's and The Graph's lockups are monochrome at
 * source, so they have none to take; inventing one for a sponsor's mark would be
 * worse than leaving it in ink.
 */
export type SponsorId = "0g" | "base" | "hedera" | "thegraph";

interface Mark {
  /** The sponsor's own name for itself — also the accessible label. */
  name: string;
  viewBox: string;
  /** Its own brand colour, when the supplied asset actually has one. */
  brand?: string;
  /**
   * Optical correction, not geometry. Set to one height, the four lockups do not
   * read as one size: 0G's mark is all letterform, where the other three spend
   * their height on an icon and set the wordmark smaller. Matching the boxes makes
   * 0G shout; this matches what the eye actually measures.
   */
  scale?: number;
  body: ReactNode;
}

const MARKS: Record<SponsorId, Mark> = {
  "0g": {
    name: "0G",
    viewBox: "76 159 341 182",
    brand: "#9200E1",
    scale: 0.78,
    body: (
      <>
${indent(jsxAttrs(og), "        ")}
      </>
    ),
  },
  base: {
    name: "Base",
    viewBox: "0 0 1280 323.84",
    brand: "#0000FF",
    scale: 0.72,
    body: (
      <>
${indent(jsxAttrs(base), "        ")}
      </>
    ),
  },
  hedera: {
    name: "Hedera",
    viewBox: "0 0 1200 333.6",
    body: (
      <>
${indent(jsxAttrs(hedera), "        ")}
      </>
    ),
  },
  thegraph: {
    name: "The Graph",
    viewBox: "0 0 238 56",
    body: (
      <>
${indent(jsxAttrs(graph), "        ")}
      </>
    ),
  },
};

/**
 * @param className sets the height (e.g. "h-5"); the mark keeps its own aspect ratio.
 * @param title     when false the mark is decorative — use it where the sponsor's
 *                  name is already written next to it, so a screen reader is not
 *                  made to say "Hedera Hedera".
 */
export function SponsorLogo({
  id,
  className = "h-5",
  title = true,
}: {
  id: SponsorId;
  className?: string;
  title?: boolean;
}) {
  const mark = MARKS[id];
  return (
    <span
      className={\`\${styles.logo} \${className}\`}
      style={mark.brand ? ({ "--brand": mark.brand } as CSSProperties) : undefined}
    >
      <svg
        viewBox={mark.viewBox}
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className="w-auto"
        style={{ height: \`\${(mark.scale ?? 1) * 100}%\` }}
        role={title ? "img" : "presentation"}
        aria-label={title ? mark.name : undefined}
        aria-hidden={title ? undefined : true}
      >
        {mark.body}
      </svg>
    </span>
  );
}
`;

writeFileSync(OUT, file);
console.log("wrote", OUT, file.length, "bytes");
