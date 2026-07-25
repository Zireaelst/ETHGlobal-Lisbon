// tests/gates/_harness.ts — kapı testleri için minimal koşucu.
//
// BUILD-PLAN §0 disiplin kuralı 2: "Bende çalıştı" kapı geçmez; `pnpm gate:P0-A` yeşil olacak.
// Bu yüzden her kapı ikili (geçti/geçmedi) kriterlerden oluşur ve exit code ile konuşur.

export type CheckResult = { ok: boolean; detail: string };

type Check = { name: string; run: () => Promise<CheckResult> | CheckResult };

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export class Gate {
  private checks: Check[] = [];

  constructor(
    private readonly id: string,
    private readonly title: string,
  ) {}

  /** Kapı kriteri ekle. `run` true dönerse kriter geçer. */
  check(name: string, run: Check['run']): this {
    this.checks.push({ name, run });
    return this;
  }

  async run(): Promise<never> {
    console.log(`\n${BOLD}🚦 ${this.id} — ${this.title}${RESET}\n`);
    let failed = 0;

    for (const c of this.checks) {
      let result: CheckResult;
      try {
        result = await c.run();
      } catch (err) {
        result = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
      const mark = result.ok ? `${GREEN}[✓]${RESET}` : `${RED}[✗]${RESET}`;
      console.log(`${mark} ${c.name}`);
      if (result.detail) {
        for (const line of result.detail.split('\n')) console.log(`    ${DIM}${line}${RESET}`);
      }
      if (!result.ok) failed++;
    }

    const total = this.checks.length;
    console.log('');
    if (failed === 0) {
      console.log(`${GREEN}${BOLD}KAPI GEÇTİ${RESET} — ${this.id}: ${total}/${total} kriter yeşil.`);
      console.log(`${DIM}Sonraki adım: git tag gate/${this.id}${RESET}\n`);
      process.exit(0);
    }
    console.log(`${RED}${BOLD}KAPI GEÇMEDİ${RESET} — ${this.id}: ${failed}/${total} kriter kırmızı.`);
    console.log(`${DIM}BUILD-PLAN §0 kural 1: kırmızı kapının üstüne inşa etme.${RESET}\n`);
    process.exit(1);
  }
}

export const pass = (detail = ''): CheckResult => ({ ok: true, detail });
export const fail = (detail: string): CheckResult => ({ ok: false, detail });
