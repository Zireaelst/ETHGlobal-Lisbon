// packages/shared/src/config.ts — env reading + zod validation.
//
// BUILD-PLAN P0-A gate criterion: "when run with a missing .env field it fails and says
// WHICH field is missing". That is why the error message names the field and states what
// was expected.
//
// There are two tiers:
//   - CORE: MUST be populated at P0-A (wallets, RPCs, facilitator).
//   - LATER: populated in later phases (VERIFIER_ADDRESS after deploy, HEDERA_TOPIC_ID
//     after P0-E, subgraph keys in P2). These become mandatory the moment they are used
//     via `requireEnv()` — they fail at the right time rather than failing early.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Find the repo root (walk upwards looking for pnpm-workspace.yaml). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

let loaded = false;
/** Load .env from the repo root once. Does not override an already-set process env. */
export function loadDotenv(): void {
  if (loaded) return;
  const envPath = resolve(repoRoot(), '.env');
  if (existsSync(envPath)) dotenv.config({ path: envPath });
  loaded = true;
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

const hexPrivKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x + 64 hex digits (32-byte secp256k1 private key)');

const httpUrl = z.string().url('must be a valid http(s) URL');

const hederaAccountId = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Hedera account id must be shard.realm.num (e.g. 0.0.12345)');

const evmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be 0x + 40 hex digits (EVM address)');

/** `loadConfig()` validates some secrets but does NOT return their value; this is returned instead. */
export const REDACTED_SECRET = '[REDACTED — accessed through packages/payment/src/signer]';

/** Schema for the mandatory env (must be populated at P0-A). */
const coreSchema = z.object({
  // --- Base Sepolia ---
  BASE_RPC_URL: httpUrl,
  PRIVATE_KEY_ALICE: hexPrivKey,
  PRIVATE_KEY_BOB: hexPrivKey,
  PRIVATE_KEY_DEPLOYER: hexPrivKey,
  ERC8004_IDENTITY: evmAddress,
  USDC_BASE_SEPOLIA: evmAddress,

  // --- 0G ---
  OG_RPC_URL: httpUrl,
  OG_PRIVATE_KEY: hexPrivKey,

  // --- Hedera ---
  HEDERA_OPERATOR_ID: hederaAccountId,
  // NOTE: validated but its VALUE IS NOT RETURNED. The Hedera signing key is only read
  // from inside packages/payment/src/signer/ (BUILD-PLAN P4-C delegated signing).
  // If `loadConfig()` returned it, it would have entered every agent's context — the
  // gate:P4-C gate tests this at runtime.
  HEDERA_OPERATOR_KEY: z
    .string()
    .min(1, 'cannot be empty (DER or hex private key)')
    .transform(() => REDACTED_SECRET),
  HEDERA_NETWORK: z.enum(['testnet', 'previewnet', 'mainnet']),
  BLOCKY402_URL: httpUrl,
  BLOCKY402_FEE_PAYER: hederaAccountId,

  // --- Mode switches (BUILD-PLAN P0-A) ---
  MOCK_0G: z.enum(['0', '1']).default('0'),
  FRAUD_MODE: z.enum(['none', 'substitute', 'tamper', 'forge', 'selfintent']).default('none'),
});

export type CoreConfig = z.infer<typeof coreSchema>;

/** Fields populated in later phases; mandatory the moment they are used. */
const LATER_KEYS = [
  'VERIFIER_ADDRESS',
  'VERIFIER_DEPLOY_BLOCK',
  'ALICE_AGENT_ID',
  'BOB_AGENT_ID',
  'DECOY_AGENT_ID',
  'BOB_PUBLIC_URL',
  'OG_PROVIDER_ADDRESS',
  'OG_TAPP_ENDPOINT',
  'OG_AGENT_ID',
  'HEDERA_TOPIC_ID',
  'BOB_HEDERA_ACCOUNT',
  'GRAPH_DEPLOY_KEY',
  'SUBGRAPH_SLUG',
  'SUBGRAPH_QUERY_URL',
  'SUBGRAPH_START_BLOCK',
  'THEGRAPH_API_KEY',
  'ALICE_ECIES_PRIV',
  'BOB_ECIES_PRIV',
] as const;

export type LaterKey = (typeof LATER_KEYS)[number];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function formatIssues(issues: z.ZodIssue[]): string {
  const lines = issues.map((i) => {
    const key = i.path.join('.') || '(root)';
    const missing = i.code === 'invalid_type' && (i as { received?: string }).received === 'undefined';
    return missing ? `  ✗ ${key} — MISSING (not defined in .env, or empty)` : `  ✗ ${key} — ${i.message}`;
  });
  return [
    `.env validation failed — ${issues.length} field(s) invalid:`,
    ...lines,
    '',
    `Template: ${resolve(repoRoot(), '.env.example')}`,
  ].join('\n');
}

let cached: CoreConfig | undefined;

/**
 * Validate and return the mandatory env. Reports the missing/invalid field BY NAME.
 * @param source env source, for testability (default: process.env)
 */
export function loadConfig(source?: NodeJS.ProcessEnv): CoreConfig {
  if (!source && cached) return cached;
  if (!source) loadDotenv();

  const env = source ?? process.env;
  // Treat an empty string as "missing" — writing `FOO=` does not count as populated.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.trim() !== '') cleaned[k] = v.trim();
  }

  const parsed = coreSchema.safeParse(cleaned);
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error.issues));

  if (!source) cached = parsed.data;
  return parsed.data;
}

/** Make a later-phase field mandatory at the moment it is used. */
export function requireEnv(key: LaterKey, hint?: string): string {
  loadDotenv();
  const v = process.env[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ConfigError(
      `.env field MISSING: ${key}${hint ? ` — ${hint}` : ''}\n` +
        `This field is populated in a later phase; you just ran code that depends on it.`,
    );
  }
  return v.trim();
}

/** Optional field — undefined when absent. */
export function optionalEnv(key: LaterKey): string | undefined {
  loadDotenv();
  const v = process.env[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** All key names in `.env.example` — the gate test compares this against .env. */
export function exampleKeys(): string[] {
  const p = resolve(repoRoot(), '.env.example');
  const text = readFileSync(p, 'utf8');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0]!.trim())
    .filter(Boolean);
}

export const CORE_KEYS = Object.keys(coreSchema.shape) as (keyof CoreConfig)[];
export { LATER_KEYS };
