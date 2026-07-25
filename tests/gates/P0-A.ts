// tests/gates/P0-A.ts — the repo skeleton + env + faucet gate.
//
// BUILD-PLAN P0-A pass criteria:
//   [ ] pnpm -r build succeeds
//   [ ] the script prints the balance of all 4 accounts; all of them > 0
//   [ ] running with a missing .env field fails and says WHICH field is missing

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';
import { AccountBalanceQuery, AccountId, Client } from '@hiero-ledger/sdk';
import {
  CORE_KEYS,
  ConfigError,
  exampleKeys,
  loadConfig,
  loadDotenv,
  repoRoot,
} from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

// Load .env FIRST: the "one missing field" tests below must remove a single field from a
// genuinely populated env. Without loading it, every field looks missing and the test goes
// falsely green.
loadDotenv();

const root = repoRoot();
const gate = new Gate('P0-A', 'Repo iskeleti + env + faucet');

// --- 1. Directory tree (BUILD-PLAN §2.1) -----------------------------------
const REQUIRED_PATHS = [
  'pnpm-workspace.yaml',
  'packages/shared/src/config.ts',
  'packages/alice-agent',
  'packages/bob-agent',
  'packages/bob-binding',
  'packages/payment',
  'packages/web',
  'contracts/src',
  'subgraph',
  'fixtures/og',
  'fixtures/seal',
  'tests/gates',
  'scripts',
];

gate.check('The directory tree matches BUILD-PLAN §2.1', () => {
  const missing = REQUIRED_PATHS.filter((p) => !existsSync(resolve(root, p)));
  return missing.length === 0
    ? pass(`${REQUIRED_PATHS.length} yol mevcut`)
    : fail(`eksik: ${missing.join(', ')}`);
});

// --- 2. pnpm -r build ------------------------------------------------------
gate.check('pnpm -r build succeeds', () => {
  try {
    execFileSync('pnpm', ['-r', 'build'], { cwd: root, stdio: 'pipe', shell: true });
    return pass('every workspace package compiled');
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`.trim();
    return fail(out.split('\n').slice(-25).join('\n'));
  }
});

// --- 3. .env <-> .env.example senkron --------------------------------------
gate.check('.env.example covers every mandatory field', () => {
  const keys = new Set(exampleKeys());
  const missing = CORE_KEYS.filter((k) => !keys.has(k));
  return missing.length === 0
    ? pass(`${keys.size} fields defined`)
    : fail(`.env.example'da eksik: ${missing.join(', ')}`);
});

// --- 4. A meaningful error on a missing field ------------------------------
/** Extract the reported field names from the error message (the "  ✗ FIELD — ..." lines). */
function reportedFields(message: string): string[] {
  return message
    .split('\n')
    .map((l) => /^\s*✗\s+(\S+)\s+—/.exec(l)?.[1])
    .filter((v): v is string => Boolean(v));
}

// Delete each mandatory field one at a time: ONLY that field may be reported. Testing a single
// field is not enough — a field dropping out of the schema (a copy-paste slip) is only caught
// this way.
gate.check('A missing field is reported BY NAME (checked separately for every mandatory field)', () => {
  const problems: string[] = [];
  for (const probe of CORE_KEYS) {
    const stripped = { ...process.env };
    delete stripped[probe];
    try {
      loadConfig(stripped);
      // MOCK_0G / FRAUD_MODE have zod defaults — not throwing when absent is correct behaviour.
      const hasDefault = probe === 'MOCK_0G' || probe === 'FRAUD_MODE';
      if (!hasDefault) problems.push(`${probe}: loadConfig() did not throw despite it being deleted`);
      continue;
    } catch (err) {
      if (!(err instanceof ConfigError)) {
        problems.push(`${probe}: not a ConfigError (${String(err)})`);
        continue;
      }
      const fields = reportedFields(err.message);
      if (fields.length !== 1 || fields[0] !== probe) {
        problems.push(`${probe}: beklenen tek alan, raporlanan [${fields.join(', ')}]`);
      }
    }
  }
  return problems.length === 0
    ? pass(`each of the ${CORE_KEYS.length} mandatory fields is reported alone and by name when missing`)
    : fail(problems.join('\n'));
});

gate.check('An invalid value is reported BY NAME (not confused with a missing one)', () => {
  const bad = { ...process.env, PRIVATE_KEY_ALICE: '0xdeadbeef' };
  try {
    loadConfig(bad);
    return fail('a short private key was accepted');
  } catch (err) {
    if (!(err instanceof ConfigError)) return fail(`not the expected ConfigError: ${String(err)}`);
    const fields = reportedFields(err.message);
    if (fields.length !== 1 || fields[0] !== 'PRIVATE_KEY_ALICE') {
      return fail(`beklenen tek alan PRIVATE_KEY_ALICE, raporlanan [${fields.join(', ')}]`);
    }
    if (err.message.includes('MISSING')) return fail('invalid value is reported as "MISSING"');
    return pass(err.message.split('\n')[1]?.trim() ?? '');
  }
});

// --- 5. Full .env validation ------------------------------------------------
let cfg: ReturnType<typeof loadConfig> | undefined;
gate.check('.env passes every mandatory field', () => {
  try {
    cfg = loadConfig();
    return pass(`${CORE_KEYS.length} mandatory fields validated`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
});

// --- 6. The balance of four accounts ---------------------------------------
// "4 accounts": Alice + Bob on Base Sepolia (+ the deployer, for gas), the compute payer on 0G,
// and the operator on Hedera. All must be > 0, otherwise a faucet is missing.
type BalanceRow = { chain: string; who: string; address: string; balance: string; ok: boolean };
const rows: BalanceRow[] = [];

gate.check('Base Sepolia bakiyeleri > 0 (Alice, Bob, Deployer)', async () => {
  if (!cfg) return fail('config could not be loaded');
  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const wallets = [
    ['Alice', cfg.PRIVATE_KEY_ALICE],
    ['Bob', cfg.PRIVATE_KEY_BOB],
    ['Deployer', cfg.PRIVATE_KEY_DEPLOYER],
  ] as const;
  const lines: string[] = [];
  let allOk = true;
  for (const [who, pk] of wallets) {
    const addr = new ethers.Wallet(pk).address;
    const bal = await provider.getBalance(addr);
    const ok = bal > 0n;
    allOk &&= ok;
    rows.push({ chain: 'Base Sepolia', who, address: addr, balance: `${ethers.formatEther(bal)} ETH`, ok });
    lines.push(`${ok ? '✓' : '✗'} ${who.padEnd(9)} ${addr}  ${ethers.formatEther(bal)} ETH`);
  }
  return allOk ? pass(lines.join('\n')) : fail(`${lines.join('\n')}\n→ Base Sepolia faucet gerekli`);
});

gate.check('0G balance > 0 (the compute payer)', async () => {
  if (!cfg) return fail('config could not be loaded');
  const provider = new ethers.JsonRpcProvider(cfg.OG_RPC_URL);
  const addr = new ethers.Wallet(cfg.OG_PRIVATE_KEY).address;
  const bal = await provider.getBalance(addr);
  const ok = bal > 0n;
  rows.push({ chain: '0G Galileo', who: 'Compute payer', address: addr, balance: `${ethers.formatEther(bal)} OG`, ok });
  const line = `${addr}  ${ethers.formatEther(bal)} OG`;
  return ok ? pass(line) : fail(`${line}\n→ faucet.0g.ai (0.1 OG/day — the hardest constraint)`);
});

gate.check('Hedera operator balance > 0', async () => {
  if (!cfg) return fail('config could not be loaded');
  const client =
    cfg.HEDERA_NETWORK === 'testnet'
      ? Client.forTestnet()
      : cfg.HEDERA_NETWORK === 'previewnet'
        ? Client.forPreviewnet()
        : Client.forMainnet();
  try {
    const bal = await new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(cfg.HEDERA_OPERATOR_ID))
      .execute(client);
    const ok = bal.hbars.toTinybars().greaterThan(0);
    rows.push({ chain: `Hedera ${cfg.HEDERA_NETWORK}`, who: 'Operator', address: cfg.HEDERA_OPERATOR_ID, balance: bal.hbars.toString(), ok });
    const line = `${cfg.HEDERA_OPERATOR_ID}  ${bal.hbars.toString()}`;
    return ok ? pass(line) : fail(`${line}\n→ portal.hedera.com faucet`);
  } finally {
    client.close();
  }
});

gate.check('The balance table was printed (4+ accounts)', () => {
  if (rows.length < 4) return fail(`sadece ${rows.length} hesap okunabildi`);
  const lines = rows.map(
    (r) => `${r.ok ? '✓' : '✗'} ${r.chain.padEnd(16)} ${r.who.padEnd(14)} ${r.address.padEnd(44)} ${r.balance}`,
  );
  const allOk = rows.every((r) => r.ok);
  return allOk ? pass(lines.join('\n')) : fail(lines.join('\n'));
});

await gate.run();
