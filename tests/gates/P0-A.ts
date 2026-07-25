// tests/gates/P0-A.ts — Repo iskeleti + env + faucet kapısı.
//
// BUILD-PLAN P0-A geçiş kriterleri:
//   [ ] pnpm -r build hatasız
//   [ ] Script her 4 hesabın bakiyesini basar; hepsi > 0
//   [ ] .env eksik alanla çalıştırıldığında hangi alanın eksik olduğunu söyleyerek patlar

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

// .env'i ÖNCE yükle: aşağıdaki "tek alan eksik" testleri gerçekten dolu bir env'den
// tek alan çıkarmalı. Yüklemeden yapılırsa her alan eksik görünür ve test sahte yeşil verir.
loadDotenv();

const root = repoRoot();
const gate = new Gate('P0-A', 'Repo iskeleti + env + faucet');

// --- 1. Klasör ağacı (BUILD-PLAN §2.1) -------------------------------------
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

gate.check('Klasör ağacı BUILD-PLAN §2.1 ile uyumlu', () => {
  const missing = REQUIRED_PATHS.filter((p) => !existsSync(resolve(root, p)));
  return missing.length === 0
    ? pass(`${REQUIRED_PATHS.length} yol mevcut`)
    : fail(`eksik: ${missing.join(', ')}`);
});

// --- 2. pnpm -r build ------------------------------------------------------
gate.check('pnpm -r build hatasız', () => {
  try {
    execFileSync('pnpm', ['-r', 'build'], { cwd: root, stdio: 'pipe', shell: true });
    return pass('tüm workspace paketleri derlendi');
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`.trim();
    return fail(out.split('\n').slice(-25).join('\n'));
  }
});

// --- 3. .env <-> .env.example senkron --------------------------------------
gate.check('.env.example tüm zorunlu alanları kapsıyor', () => {
  const keys = new Set(exampleKeys());
  const missing = CORE_KEYS.filter((k) => !keys.has(k));
  return missing.length === 0
    ? pass(`${keys.size} alan tanımlı`)
    : fail(`.env.example'da eksik: ${missing.join(', ')}`);
});

// --- 4. Eksik alanda anlamlı hata ------------------------------------------
/** Hata mesajından raporlanan alan adlarını çıkar ("  ✗ ALAN — ..." satırları). */
function reportedFields(message: string): string[] {
  return message
    .split('\n')
    .map((l) => /^\s*✗\s+(\S+)\s+—/.exec(l)?.[1])
    .filter((v): v is string => Boolean(v));
}

// Her zorunlu alanı tek tek sil: SADECE o alan raporlanmalı. Tek alan denemek yetmez —
// bir alanın şemadan düşmesi (kopyala-yapıştır hatası) ancak böyle yakalanır.
gate.check('Eksik alan ADIYLA raporlanıyor (her zorunlu alan için ayrı ayrı)', () => {
  const problems: string[] = [];
  for (const probe of CORE_KEYS) {
    const stripped = { ...process.env };
    delete stripped[probe];
    try {
      loadConfig(stripped);
      // MOCK_0G / FRAUD_MODE'un zod default'u var — eksikken patlamamaları doğru davranış.
      const hasDefault = probe === 'MOCK_0G' || probe === 'FRAUD_MODE';
      if (!hasDefault) problems.push(`${probe}: silindiği halde loadConfig() patlamadı`);
      continue;
    } catch (err) {
      if (!(err instanceof ConfigError)) {
        problems.push(`${probe}: ConfigError değil (${String(err)})`);
        continue;
      }
      const fields = reportedFields(err.message);
      if (fields.length !== 1 || fields[0] !== probe) {
        problems.push(`${probe}: beklenen tek alan, raporlanan [${fields.join(', ')}]`);
      }
    }
  }
  return problems.length === 0
    ? pass(`${CORE_KEYS.length} zorunlu alanın her biri eksikken tek başına ve adıyla raporlanıyor`)
    : fail(problems.join('\n'));
});

gate.check('Geçersiz değer ADIYLA raporlanıyor (eksik ile karışmıyor)', () => {
  const bad = { ...process.env, PRIVATE_KEY_ALICE: '0xdeadbeef' };
  try {
    loadConfig(bad);
    return fail('kısa private key kabul edildi');
  } catch (err) {
    if (!(err instanceof ConfigError)) return fail(`beklenen ConfigError değil: ${String(err)}`);
    const fields = reportedFields(err.message);
    if (fields.length !== 1 || fields[0] !== 'PRIVATE_KEY_ALICE') {
      return fail(`beklenen tek alan PRIVATE_KEY_ALICE, raporlanan [${fields.join(', ')}]`);
    }
    if (err.message.includes('MISSING')) return fail('invalid value is reported as "MISSING"');
    return pass(err.message.split('\n')[1]?.trim() ?? '');
  }
});

// --- 5. Tam .env doğrulaması ------------------------------------------------
let cfg: ReturnType<typeof loadConfig> | undefined;
gate.check('.env zorunlu alanların hepsini geçiyor', () => {
  try {
    cfg = loadConfig();
    return pass(`${CORE_KEYS.length} zorunlu alan doğrulandı`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
});

// --- 6. Dört hesabın bakiyesi ----------------------------------------------
// "4 hesap": Base Sepolia'da Alice + Bob (+ deployer, gaz için), 0G'de compute ödeyicisi,
// Hedera'da operatör. Hepsi > 0 olmalı, yoksa faucet eksik.
type BalanceRow = { chain: string; who: string; address: string; balance: string; ok: boolean };
const rows: BalanceRow[] = [];

gate.check('Base Sepolia bakiyeleri > 0 (Alice, Bob, Deployer)', async () => {
  if (!cfg) return fail('config yüklenemedi');
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

gate.check('0G bakiyesi > 0 (compute ödeyicisi)', async () => {
  if (!cfg) return fail('config yüklenemedi');
  const provider = new ethers.JsonRpcProvider(cfg.OG_RPC_URL);
  const addr = new ethers.Wallet(cfg.OG_PRIVATE_KEY).address;
  const bal = await provider.getBalance(addr);
  const ok = bal > 0n;
  rows.push({ chain: '0G Galileo', who: 'Compute payer', address: addr, balance: `${ethers.formatEther(bal)} OG`, ok });
  const line = `${addr}  ${ethers.formatEther(bal)} OG`;
  return ok ? pass(line) : fail(`${line}\n→ faucet.0g.ai (0.1 OG/gün — en sert kısıt)`);
});

gate.check('Hedera operatör bakiyesi > 0', async () => {
  if (!cfg) return fail('config yüklenemedi');
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

gate.check('Bakiye tablosu basıldı (4+ hesap)', () => {
  if (rows.length < 4) return fail(`sadece ${rows.length} hesap okunabildi`);
  const lines = rows.map(
    (r) => `${r.ok ? '✓' : '✗'} ${r.chain.padEnd(16)} ${r.who.padEnd(14)} ${r.address.padEnd(44)} ${r.balance}`,
  );
  const allOk = rows.every((r) => r.ok);
  return allOk ? pass(lines.join('\n')) : fail(lines.join('\n'));
});

await gate.run();
