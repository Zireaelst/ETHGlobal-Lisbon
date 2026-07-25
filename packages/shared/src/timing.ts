// timing.ts — aşama süreleri için minik kronometre.
//
// BUILD-PLAN P0-G ikinci kriteri: "Zaman dağılımı biliniyor: ECIES / 0G çağrısı /
// seal imzası / ağ — hangisi baskın?" Toplam süreyi bilmek yetmiyor; video günü
// yavaşlarsak NEYİ kısacağımızı bilmemiz gerekiyor.
//
// Bilerek aptal: sıralı `mark()` çağrıları arasındaki farkı tutuyor. İç içe
// ölçüm, ortalama, histogram yok — ölçtüğümüz şey birkaç saniyelik aşamalar,
// daha fazlası kendi gürültüsünü ölçmek olurdu.

export type StageMs = Record<string, number>;

export interface Stopwatch {
  /** Bir aşamayı bitir: son işaretten bu yana geçen süreyi `label` altına yaz. */
  mark(label: string): void;
  /** Bir söz'ü ölç ve sonucunu döndür. */
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** Toplanan aşamalar. */
  stages(): StageMs;
  /** İlk işaretten bu yana toplam. */
  totalMs(): number;
}

export function createStopwatch(): Stopwatch {
  const startedAt = Date.now();
  let last = startedAt;
  const collected: StageMs = {};

  const add = (label: string, ms: number) => {
    // Aynı etiket birden çok kez ölçülürse TOPLA. Örn. iki ayrı ECIES işlemi
    // tek bir "ecies" kalemi olsun — dağılım okunur kalsın.
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

/** En büyük kalemi bul — "hangisi baskın?" sorusunun cevabı. */
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

/** Sıralı örneklemden yüzdelik. Küçük örneklemde p95 pratikte en yavaş koşudur — bu İYİ. */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}
