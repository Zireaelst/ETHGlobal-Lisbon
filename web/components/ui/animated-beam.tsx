"use client";

import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

export type BeamAnchor = "top" | "right" | "bottom" | "left";

/**
 * Read-only so a `RefObject<HTMLDivElement>` from a caller is assignable —
 * React's own RefObject is mutable, and therefore invariant in its element
 * type, which would force every caller to widen its refs by hand.
 */
export type ElementRef = { readonly current: HTMLElement | null };

export interface BeamSpec {
  from: ElementRef;
  to: ElementRef;
  fromAnchor: BeamAnchor;
  toAnchor: BeamAnchor;
}

const NORMAL: Record<BeamAnchor, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

/**
 * Offset geometry rather than getBoundingClientRect: the cards animate in
 * with a translate, and a client rect would bake that transient transform
 * into the beam coordinates, leaving every wire a few pixels off its card
 * once the entrance settles.
 */
function offsetWithin(el: HTMLElement, origin: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== origin) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function anchorPoint(
  box: { x: number; y: number; w: number; h: number },
  anchor: BeamAnchor,
) {
  switch (anchor) {
    case "left":
      return { x: box.x, y: box.y + box.h / 2 };
    case "right":
      return { x: box.x + box.w, y: box.y + box.h / 2 };
    case "top":
      return { x: box.x + box.w / 2, y: box.y };
    case "bottom":
      return { x: box.x + box.w / 2, y: box.y + box.h };
  }
}

/**
 * Builds a cubic bezier that leaves `from` along its edge normal and enters
 * `to` along its own — so a beam between two side-by-side cards reads as a
 * straight wire, while one that has to drop a row curves out and back in
 * like a trace on a board instead of cutting diagonally across the grid.
 */
function buildPath(spec: BeamSpec, origin: HTMLElement): string | null {
  const a = spec.from.current;
  const b = spec.to.current;
  if (!a || !b) return null;

  const p1 = anchorPoint(offsetWithin(a, origin), spec.fromAnchor);
  const p2 = anchorPoint(offsetWithin(b, origin), spec.toAnchor);

  const n1 = NORMAL[spec.fromAnchor];
  const n2 = NORMAL[spec.toAnchor];

  // Bend is capped by the gap the beam actually has to cross along its exit
  // normal, so a wire dropping between two rows curves inside that gap
  // instead of overshooting behind the card it is heading for.
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const along = Math.abs((p2.x - p1.x) * n1[0] + (p2.y - p1.y) * n1[1]);
  const bend = Math.min(Math.max(Math.min(dist * 0.4, along * 0.75), 16), 96);
  const c1 = { x: p1.x + n1[0] * bend, y: p1.y + n1[1] * bend };
  const c2 = { x: p2.x + n2[0] * bend, y: p2.y + n2[1] * bend };

  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
}

/**
 * Draws the wires between bento cells and sends a packet of light down each
 * one. Geometry is measured from the live DOM (and re-measured on resize),
 * so the beams stay glued to the card edges at any breakpoint rather than
 * being hard-coded to a layout that only holds at one width.
 *
 * The wires themselves are tied to `revealed` (the section being on screen)
 * rather than to `progress`, so the diagram is always structurally complete
 * — an interrupted intro sequence must never leave the reader looking at
 * disconnected cards. `progress` only decides which wires are carrying a
 * packet of light yet.
 */
export function AnimatedBeamGroup({
  containerRef,
  beams,
  revealed,
  progress,
  activeIndex,
  enabled = true,
}: {
  containerRef: ElementRef;
  beams: BeamSpec[];
  /** the section has scrolled into view: draw the wires in */
  revealed: boolean;
  /** index of the last beam the flow has reached; -1 = not started */
  progress: number;
  /** beam index to highlight (the one entering the hovered card), or null */
  activeIndex: number | null;
  enabled?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const [paths, setPaths] = useState<(string | null)[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !enabled) return;

    // Both setters bail out when nothing actually moved. Re-rendering on
    // every ResizeObserver callback with fresh object identities is how a
    // measure-then-render loop turns into a resize feedback loop.
    const measure = () => {
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));

      const next = beams.map((beam) => buildPath(beam, host));
      setPaths((prev) =>
        prev.length === next.length && prev.every((d, i) => d === next[i])
          ? prev
          : next,
      );
    };

    measure();
    // The container alone is enough: every card is laid out by the grid
    // inside it, so a card reflow is a container reflow.
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [containerRef, beams, enabled]);

  if (!enabled || size.w === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${size.w} ${size.h}`}
      fill="none"
    >
      <defs>
        <linearGradient id={`${uid}-pulse`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--chap-warm)" />
          <stop offset="100%" stopColor="var(--chap-cool)" />
        </linearGradient>
      </defs>

      {paths.map((d, i) => {
        if (!d) return null;
        const reached = progress >= i;
        const hot = activeIndex === i;
        return (
          <g key={i}>
            {/* pathLength / pathOffset rather than raw stroke dashes:
                motion drives those through its own path-drawing API, and a
                hand-rolled strokeDashoffset animation is silently ignored. */}
            <motion.path
              d={d}
              stroke="var(--line)"
              strokeWidth={1}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0.45 }}
              animate={{
                pathLength: revealed ? 1 : 0,
                opacity: hot ? 0.95 : 0.45,
              }}
              transition={{
                pathLength: {
                  duration: 0.7,
                  delay: 0.15 + i * 0.12,
                  ease: [0.16, 1, 0.3, 1],
                },
                opacity: { duration: 0.4 },
              }}
            />

            {reached && !reduced && (
              <>
                {/* A wide, faint companion stroke instead of a drop-shadow
                    filter: same bloom, without re-filtering an animating
                    stroke on every frame. */}
                <motion.path
                  d={d}
                  stroke={`url(#${uid}-pulse)`}
                  strokeWidth={hot ? 7 : 5}
                  strokeLinecap="round"
                  opacity={0.22}
                  initial={{ pathLength: 0.18, pathOffset: 0 }}
                  animate={{ pathOffset: 1 }}
                  transition={{
                    duration: hot ? 1.5 : 2.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.3,
                    repeatDelay: hot ? 0.15 : 0.8,
                  }}
                />
                <motion.path
                  d={d}
                  stroke={`url(#${uid}-pulse)`}
                  strokeWidth={hot ? 2.5 : 1.75}
                  strokeLinecap="round"
                  initial={{ pathLength: 0.18, pathOffset: 0 }}
                  animate={{ pathOffset: 1 }}
                  transition={{
                    duration: hot ? 1.5 : 2.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.3,
                    repeatDelay: hot ? 0.15 : 0.8,
                  }}
                />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
