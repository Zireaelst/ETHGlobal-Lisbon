// tests/gates/_harness.ts — a minimal runner for the gate tests.
//
// BUILD-PLAN §0 discipline rule 2: "it worked on my machine" does not pass a gate; `pnpm
// gate:P0-A` has to be green. So every gate consists of binary (pass/fail) criteria and speaks
// through its exit code.

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

  /** Add a gate criterion. The criterion passes when `run` returns true. */
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
      console.log(`${GREEN}${BOLD}GATE PASSED${RESET} — ${this.id}: ${total}/${total} criteria green.`);
      console.log(`${DIM}Next step: git tag gate/${this.id}${RESET}\n`);
      process.exit(0);
    }
    console.log(`${RED}${BOLD}GATE FAILED${RESET} — ${this.id}: ${failed}/${total} criteria red.`);
    console.log(`${DIM}BUILD-PLAN §0 rule 1: do not build on top of a red gate.${RESET}\n`);
    process.exit(1);
  }
}

export const pass = (detail = ''): CheckResult => ({ ok: true, detail });
export const fail = (detail: string): CheckResult => ({ ok: false, detail });
