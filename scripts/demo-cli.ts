// scripts/demo-cli.ts — the `pnpm demo:base` entry point.
//
// The flow itself lives in @ca/demo: it had to become a workspace package so the Next.js
// dashboard could import it (scripts/ is deliberately NOT a workspace member — see CLAUDE.md
// §7 — so nothing here is resolvable by package name). Hence the relative path.
import { main } from '../packages/demo/src/index.js';

await main();
