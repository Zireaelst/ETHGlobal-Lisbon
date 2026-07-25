// timing.ts — a tiny stopwatch for stage durations.
//
// BUILD-PLAN P0-G, second criterion: "the time distribution is known: ECIES / 0G call /
// seal signature / network — which one dominates?" Knowing the total is not enough; if we
// are slow on recording day we need to know WHICH knob to turn.
//
// Deliberately dumb: it keeps the difference between sequential `mark()` calls. No nesting,
// no averages, no histograms — what we measure are multi-second stages, and anything more
// would be measuring its own noise.

export type StageMs = Record<string, number>;

export interface Stopwatch {
  /** End a stage: record the time since the last mark under `label`. */
  mark(label: string): void;
  /** Time a promise and return its result. */
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** The collected stages. */
  stages(): StageMs;
  /** Total since the first mark. */
  totalMs(): number;
}

export function createStopwatch(): Stopwatch {
  const startedAt = Date.now();
  let last = startedAt;
  const collected: StageMs = {};

  const add = (label: string, ms: number) => {
    // If the same label is measured more than once, SUM it. E.g. two separate ECIES
    // operations become a single "ecies" line — keep the distribution readable.
    collected[label] = (collected[label] ?? 0) + ms;
  };

  return {
    mark(label) {
      const now = Date.now();
      add(label, now - last);
      last = now;
    },
    async time(label, fn) {
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        add(label, Date.now() - t0);
        last = Date.now();
      }
    },
    stages: () => ({ ...collected }),
    totalMs: () => Date.now() - startedAt,
  };
}

/** Find the largest line item — the answer to "which one dominates?". */
export function dominantStage(stages: StageMs): { label: string; ms: number; share: number } {
  const total = Object.values(stages).reduce((a, b) => a + b, 0);
  let label = '';
  let ms = -1;
  for (const [k, v] of Object.entries(stages)) {
    if (v > ms) {
      label = k;
      ms = v;
    }
  }
  return { label, ms: Math.max(ms, 0), share: total > 0 ? ms / total : 0 };
}

/** Percentile from an ordered sample. On a small sample p95 is in practice the slowest run — that is GOOD. */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}
