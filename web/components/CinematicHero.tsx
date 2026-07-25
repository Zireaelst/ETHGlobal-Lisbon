"use client";

import { useEffect, useRef } from "react";
import styles from "./CinematicHero.module.css";

type Rgb = [number, number, number];

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const band = (p: number, a: number, b: number) => smoothstep(seg(p, a, b));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const rgba = (c1: Rgb, c2: Rgb, t: number, a1: number, a2: number) =>
  "rgba(" +
  Math.round(mix(c1[0], c2[0], t)) +
  "," +
  Math.round(mix(c1[1], c2[1], t)) +
  "," +
  Math.round(mix(c1[2], c2[2], t)) +
  "," +
  mix(a1, a2, t).toFixed(3) +
  ")";

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
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const layerA = useRef<HTMLDivElement>(null);
  const layerB = useRef<HTMLDivElement>(null);
  const layerC = useRef<HTMLDivElement>(null);
  const darkA = useRef<HTMLDivElement>(null);
  const darkB = useRef<HTMLDivElement>(null);
  const darkC = useRef<HTMLDivElement>(null);
  const temp = useRef<HTMLDivElement>(null);
  const bloomWarm = useRef<HTMLDivElement>(null);
  const bloomCool = useRef<HTMLDivElement>(null);
  const haze = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const vig = useRef<HTMLDivElement>(null);
  const grain = useRef<HTMLDivElement>(null);
  const cap0 = useRef<HTMLDivElement>(null);
  const cap1 = useRef<HTMLDivElement>(null);
  const cap2 = useRef<HTMLDivElement>(null);
  const dot0 = useRef<HTMLSpanElement>(null);
  const dot1 = useRef<HTMLSpanElement>(null);
  const dot2 = useRef<HTMLSpanElement>(null);
  const railFill = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const hintLine = useRef<HTMLSpanElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const labOpen = useRef<HTMLSpanElement>(null);
  const labSealed = useRef<HTMLSpanElement>(null);
  const emph = useRef<HTMLElement>(null);
  const rule = useRef<HTMLDivElement>(null);

  const anim = useRef({
    p: 0,
    target: 0,
    mx: 0,
    my: 0,
    tmx: 0,
    tmy: 0,
    theme: 1,
    themeTarget: 1,
    raf: 0,
  });

  useEffect(() => {
    const a = anim.current;
    const depth = scrollDepth ?? 340;
    if (wrap.current) wrap.current.style.height = depth + "vh";

    let saved: string | null = null;
    try {
      saved = localStorage.getItem("hero-theme");
    } catch {
      // ignore
    }
    const startDark = saved === null ? startTheme !== "open" : saved === "sealed";
    a.theme = a.themeTarget = startDark ? 1 : 0;

    if (grain.current) {
      grain.current.style.backgroundImage =
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")";
    }

    const onMove = (e: PointerEvent) => {
      a.tmx = (e.clientX / window.innerWidth - 0.5) * 2;
      a.tmy = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const measure = () => {
      const el = wrap.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      if (travel <= 0) return 0;
      return clamp(-r.top / travel);
    };

    const setLayer = (
      ref: React.RefObject<HTMLDivElement | null>,
      darkRef: React.RefObject<HTMLDivElement | null>,
      opacity: number,
      scale: number,
      blur: number,
      bright: number,
      depth: number,
      T: number,
      p: number,
      px: number,
      py: number,
    ) => {
      const el = ref.current;
      if (!el) return;
      const tx = -p * 2.2 * depth + px * 1.6 * depth;
      const ty = -p * 1.4 * depth + py * 1.1 * depth;
      const b = 1 + (bright - 1) * (0.45 + 0.55 * T);
      el.style.opacity = opacity.toFixed(3);
      el.style.transform =
        "translate3d(" + tx.toFixed(2) + "%," + ty.toFixed(2) + "%,0) scale(" + scale.toFixed(4) + ")";
      el.style.filter =
        "blur(" +
        blur.toFixed(2) +
        "px) brightness(" +
        b.toFixed(3) +
        ") saturate(" +
        (0.9 + 0.3 * opacity).toFixed(3) +
        ") contrast(" +
        mix(1.02, 1, T).toFixed(3) +
        ")";
      el.style.visibility = opacity < 0.004 ? "hidden" : "visible";
      if (darkRef.current) darkRef.current.style.opacity = T.toFixed(3);
    };

    const cap = (ref: React.RefObject<HTMLDivElement | null>, o: number) => {
      const el = ref.current;
      if (!el) return;
      el.style.opacity = o.toFixed(3);
      el.style.transform = "translateY(" + ((1 - o) * 10).toFixed(2) + "px)";
    };

    const paint = (p: number, T: number) => {
      const px = a.mx;
      const py = a.my;

      const aOut = band(p, 0.08, 0.4);
      const bIn = band(p, 0.16, 0.46);
      const bOut = band(p, 0.56, 0.86);
      const cIn = band(p, 0.6, 0.94);

      setLayer(layerA, darkA, 1 - aOut, 1.04 + 0.13 * smoothstep(seg(p, 0, 0.5)), softness * aOut, 1 - 0.45 * aOut, 1.0, T, p, px, py);
      setLayer(layerB, darkB, clamp(bIn - bOut), 1.16 - 0.14 * bIn + 0.11 * bOut, softness * (1 - bIn) * 0.85 + softness * bOut * 0.85, 0.72 + 0.28 * bIn - 0.35 * bOut, 1.35, T, p, px, py);
      setLayer(layerC, darkC, cIn, 1.19 - 0.19 * cIn, softness * (1 - cIn), 0.7 + 0.3 * cIn, 1.7, T, p, px, py);

      const cross = Math.exp(-Math.pow((p - 0.31) / 0.1, 2)) + Math.exp(-Math.pow((p - 0.73) / 0.1, 2));
      const glow = (0.55 + 0.75 * cross) * bloomIntensity;
      const bt =
        "translate3d(" + (px * -1.2).toFixed(2) + "%," + (py * -1).toFixed(2) + "%,0) scale(" + (1 + 0.1 * cross).toFixed(3) + ")";
      if (bloomWarm.current) {
        bloomWarm.current.style.opacity = ((1 - band(p, 0.12, 0.44)) * glow * mix(0.5, 1, T)).toFixed(3);
        bloomWarm.current.style.transform = bt;
      }
      if (bloomCool.current) {
        bloomCool.current.style.opacity = (band(p, 0.18, 0.52) * glow * mix(0.28, 1, T)).toFixed(3);
        bloomCool.current.style.transform = bt;
      }
      if (haze.current) {
        haze.current.style.opacity = ((1 - T) * (0.42 + 0.35 * cross) * bloomIntensity).toFixed(3);
        haze.current.style.transform = bt;
      }

      if (temp.current) {
        temp.current.style.background =
          "linear-gradient(120deg, " +
          rgba([255, 238, 208], [24, 46, 104], T, 0.55, 0.5) +
          ", " +
          rgba([255, 248, 232], [10, 22, 62], T, 0.2, 0.42) +
          ")";
        temp.current.style.opacity = mix(0.55, 0.7, T).toFixed(3);
      }

      if (scrim.current) {
        const st = (av: [number, number]) => rgba([246, 242, 234], [5, 6, 10], T, av[0], av[1]);
        scrim.current.style.background =
          "linear-gradient(100deg, " +
          st([0.9, 0.94]) +
          " 0%, " +
          st([0.8, 0.86]) +
          " 24%, " +
          st([0.46, 0.52]) +
          " 46%, " +
          st([0.1, 0.12]) +
          " 64%, " +
          st([0, 0]) +
          " 78%)";
      }
      if (vig.current) {
        vig.current.style.background =
          "radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 38%, " + rgba([150, 132, 100], [0, 0, 0], T, 0.16, 0.55) + " 100%)";
      }
      if (grain.current) {
        grain.current.style.opacity = mix(0.035, 0.05, T).toFixed(3);
        grain.current.style.mixBlendMode = T > 0.5 ? "overlay" : "multiply";
      }

      const st2 = stage.current;
      if (st2) {
        st2.style.setProperty("--ink", rgba([35, 32, 27], [242, 239, 232], T, 1, 1));
        st2.style.setProperty("--ink-soft", rgba([48, 44, 37], [232, 227, 216], T, 0.66, 0.6));
        st2.style.setProperty("--line", rgba([48, 44, 37], [232, 227, 216], T, 0.26, 0.28));
        st2.style.setProperty("--fill", rgba([255, 255, 255], [255, 255, 255], T, 0.34, 0.04));
        st2.style.setProperty("--chap-warm", rgba([150, 112, 40], [214, 168, 96], T, 0.92, 0.8));
        st2.style.setProperty("--chap-cool", rgba([48, 88, 168], [150, 184, 255], T, 0.9, 0.84));
        st2.style.background = rgba([243, 239, 230], [5, 6, 10], T, 1, 1);
      }
      if (emph.current) emph.current.style.color = rgba([120, 96, 52], [230, 220, 198], T, 1, 1);
      if (rule.current) {
        rule.current.style.background = "linear-gradient(90deg, rgba(214,168,96,0), " + rgba([168, 128, 56], [214, 168, 96], T, 0.9, 0.9) + ")";
      }
      const dotWarm = rgba([160, 120, 44], [214, 168, 96], T, 0.95, 0.9);
      const dotCool = rgba([44, 84, 176], [96, 148, 255], T, 0.95, 0.95);
      if (dot0.current) dot0.current.style.background = dotWarm;
      if (dot1.current) dot1.current.style.background = dotCool;
      if (dot2.current) dot2.current.style.background = dotCool;
      if (railFill.current) railFill.current.style.background = "linear-gradient(180deg, " + dotWarm + ", " + dotCool + ")";
      if (hintLine.current) {
        hintLine.current.style.background = "linear-gradient(180deg, " + rgba([48, 44, 37], [232, 227, 216], T, 0.45, 0.5) + ", rgba(0,0,0,0))";
      }

      if (knob.current) {
        knob.current.style.transform = "translateX(" + (T * 74).toFixed(2) + "px)";
        knob.current.style.boxShadow = "0 0 " + (6 + 10 * T).toFixed(1) + "px " + rgba([190, 150, 70], [96, 148, 255], T, 0.5, 0.75);
        knob.current.style.background = rgba([60, 52, 38], [242, 239, 232], T, 1, 1);
      }
      if (labOpen.current) labOpen.current.style.opacity = mix(1, 0.42, T).toFixed(3);
      if (labSealed.current) labSealed.current.style.opacity = mix(0.42, 1, T).toFixed(3);

      cap(cap0, 1 - band(p, 0.1, 0.26));
      cap(cap1, clamp(band(p, 0.24, 0.4) - band(p, 0.56, 0.7)));
      cap(cap2, band(p, 0.66, 0.84));

      if (railFill.current) railFill.current.style.height = (p * 100).toFixed(2) + "%";
      if (hint.current) hint.current.style.opacity = (1 - band(p, 0.02, 0.12)).toFixed(3);
    };

    const tick = () => {
      a.raf = requestAnimationFrame(tick);
      a.target = measure();
      a.p += (a.target - a.p) * 0.075;
      a.mx += (a.tmx - a.mx) * 0.05;
      a.my += (a.tmy - a.my) * 0.05;
      if (Math.abs(a.target - a.p) < 0.00015) a.p = a.target;
      const d = a.themeTarget - a.theme;
      if (Math.abs(d) > 0.0005) a.theme += d * 0.055;
      else a.theme = a.themeTarget;
      paint(a.p, smoothstep(clamp(a.theme)));
    };
    a.raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(a.raf);
      window.removeEventListener("pointermove", onMove);
    };
    // scrollDepth/softness/bloomIntensity/startTheme are read once on mount, matching the
    // original scroll-driven scene which never re-initializes on prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = () => {
    const a = anim.current;
    a.themeTarget = a.themeTarget > 0.5 ? 0 : 1;
    try {
      localStorage.setItem("hero-theme", a.themeTarget > 0.5 ? "sealed" : "open");
    } catch {
      // ignore
    }
  };

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%", height: "340vh", background: "#05060a" }}>
      <div
        ref={stage}
        style={{ position: "sticky", top: 0, height: "100vh", width: "100%", overflow: "hidden", background: "#05060a" }}
      >
        <div ref={layerA} style={{ position: "absolute", inset: "-8%", transform: "scale(1.05) translate3d(0,0,0)", willChange: "transform, opacity, filter", backfaceVisibility: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/hero/light.png)", backgroundSize: "cover", backgroundPosition: "66% center" }} />
          <div ref={darkA} style={{ position: "absolute", inset: 0, backgroundImage: "url(/hero/dark-mode-3.png)", backgroundSize: "cover", backgroundPosition: "66% center", willChange: "opacity" }} />
        </div>

        <div ref={layerB} style={{ position: "absolute", inset: "-8%", opacity: 0, transform: "scale(1.16) translate3d(0,0,0)", willChange: "transform, opacity, filter", backfaceVisibility: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/hero/light-mode-2.png)", backgroundSize: "cover", backgroundPosition: "66% center" }} />
          <div ref={darkB} style={{ position: "absolute", inset: 0, backgroundImage: "url(/hero/dark-mode-1.png)", backgroundSize: "cover", backgroundPosition: "66% center", willChange: "opacity" }} />
        </div>

        <div ref={layerC} style={{ position: "absolute", inset: "-8%", opacity: 0, transform: "scale(1.18) translate3d(0,0,0)", willChange: "transform, opacity, filter", backfaceVisibility: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/hero/light-mode-3.png)", backgroundSize: "cover", backgroundPosition: "66% center" }} />
          <div ref={darkC} style={{ position: "absolute", inset: 0, backgroundImage: "url(/hero/dark-mode-2.png)", backgroundSize: "cover", backgroundPosition: "66% center", willChange: "opacity" }} />
        </div>

        <div ref={temp} style={{ position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "soft-light", willChange: "background, opacity" }} />

        <div ref={bloomWarm} style={{ position: "absolute", top: "-10%", right: "-6%", width: "62vw", height: "120vh", pointerEvents: "none", mixBlendMode: "screen", background: "radial-gradient(closest-side at 46% 38%, rgba(214,168,96,.30), rgba(214,168,96,.10) 42%, rgba(214,168,96,0) 72%)", willChange: "opacity, transform" }} />
        <div ref={bloomCool} style={{ position: "absolute", top: "-10%", right: "-6%", width: "62vw", height: "120vh", opacity: 0, pointerEvents: "none", mixBlendMode: "screen", background: "radial-gradient(closest-side at 46% 38%, rgba(64,124,255,.42), rgba(38,86,220,.14) 44%, rgba(20,50,160,0) 74%)", willChange: "opacity, transform" }} />
        <div ref={haze} style={{ position: "absolute", top: "-12%", right: "-8%", width: "66vw", height: "124vh", opacity: 0, pointerEvents: "none", background: "radial-gradient(closest-side at 46% 36%, rgba(255,250,238,.55), rgba(255,246,226,.18) 46%, rgba(255,246,226,0) 74%)", willChange: "opacity" }} />

        <div ref={scrim} style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(100deg, rgba(5,6,10,.94) 0%, rgba(5,6,10,.86) 24%, rgba(5,6,10,.52) 46%, rgba(5,6,10,.12) 64%, rgba(5,6,10,0) 78%)", willChange: "background" }} />
        <div ref={vig} style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 38%, rgba(0,0,0,.55) 100%)", willChange: "background" }} />
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
          <div style={{ display: "flex", flexDirection: "column", gap: 30, maxWidth: 620 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div ref={rule} style={{ width: 34, height: 1, background: "linear-gradient(90deg, rgba(214,168,96,0), rgba(214,168,96,.9))" }} />
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".34em", textTransform: "uppercase", color: "var(--ink-soft, rgba(232,227,216,.62))" }}>Confidential Agents</div>
            </div>

            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(46px, 5.6vw, 92px)", lineHeight: 1.02, letterSpacing: "-0.015em", color: "var(--ink, #f2efe8)", textWrap: "pretty" }}>
              One intent, signed once.<br />
              <em ref={emph} style={{ fontStyle: "italic", color: "#e6dcc6" }}>Sealed</em> in a TEE,<br />
              verified on-chain.
            </h1>

            <p style={{ margin: 0, maxWidth: 440, fontFamily: "var(--font-body)", fontWeight: 200, fontSize: 17, lineHeight: 1.75, letterSpacing: ".012em", color: "var(--ink-soft, rgba(232,227,216,.6))" }}>
              Alice and Bob discover each other through a public registry, then keep the deal
              private — task, payment, and output bound to a single signed intent. Scroll to
              follow the proof.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 6 }}>
              <a href="#" className={styles.cta} style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "15px 30px", border: "1px solid var(--line, rgba(232,227,216,.28))", borderRadius: 999, fontFamily: "var(--font-body)", fontWeight: 300, fontSize: 14, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink, #f2efe8)", background: "var(--fill, rgba(255,255,255,.03))", backdropFilter: "blur(6px)" }}>
                Explore the demo
              </a>
              <a href="#" className={styles.watch} style={{ fontFamily: "var(--font-body)", fontWeight: 300, fontSize: 14, letterSpacing: ".08em", color: "var(--ink-soft, rgba(232,227,216,.52))" }}>
                Read the spec
              </a>
            </div>
          </div>
        </div>

        <div style={{ position: "absolute", left: "clamp(32px, 7vw, 132px)", bottom: "clamp(36px, 6vh, 68px)", height: 34, width: 460, pointerEvents: "none" }}>
          <div ref={cap0} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".28em", textTransform: "uppercase", color: "var(--chap-warm, rgba(214,168,96,.8))", willChange: "opacity, transform" }}>
            <span ref={dot0} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(214,168,96,.9)" }} />I — Discovery &amp; intent
          </div>
          <div ref={cap1} style={{ position: "absolute", inset: 0, opacity: 0, display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".28em", textTransform: "uppercase", color: "var(--chap-cool, rgba(140,178,255,.82))", willChange: "opacity, transform" }}>
            <span ref={dot1} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(96,148,255,.95)" }} />II — Sealed execution
          </div>
          <div ref={cap2} style={{ position: "absolute", inset: 0, opacity: 0, display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".28em", textTransform: "uppercase", color: "var(--chap-cool, rgba(160,192,255,.85))", willChange: "opacity, transform" }}>
            <span ref={dot2} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(96,148,255,.95)" }} />III — On-chain verdict
          </div>
        </div>

        <div style={{ position: "absolute", right: "clamp(24px, 3.4vw, 54px)", top: "50%", transform: "translateY(-50%)", height: 168, width: 1, background: "var(--line, rgba(232,227,216,.14))" }}>
          <div ref={railFill} style={{ position: "absolute", left: 0, top: 0, width: 1, height: "0%", background: "linear-gradient(180deg, rgba(214,168,96,.9), rgba(96,148,255,.9))", willChange: "height" }} />
        </div>

        <div ref={hint} style={{ position: "absolute", left: "50%", bottom: 28, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: ".3em", textTransform: "uppercase", color: "var(--ink-soft, rgba(232,227,216,.4))", animation: "heroHint 3.4s ease-in-out infinite" }}>
          Scroll
          <span ref={hintLine} style={{ width: 1, height: 26, background: "linear-gradient(180deg, rgba(232,227,216,.5), rgba(232,227,216,0))" }} />
        </div>
      </div>
    </div>
  );
}
