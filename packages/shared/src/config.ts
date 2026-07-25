// packages/shared/src/config.ts — env okuma + zod doğrulama.
//
// BUILD-PLAN P0-A kapı kriteri: ".env eksik alanla çalıştırıldığında hangi alanın eksik
// olduğunu söyleyerek patlar". Bu yüzden hata mesajı alan adını ve ne beklendiğini yazar.
//
// İki katman var:
//   - CORE: P0-A'da dolu olmak ZORUNDA (cüzdanlar, RPC'ler, facilitator).
//   - LATER: sonraki fazlarda doluyor (VERIFIER_ADDRESS deploy sonrası, HEDERA_TOPIC_ID
//     P0-E sonrası, subgraph anahtarları P2'de). Bunlar `requireEnv()` ile kullanıldıkları
//     anda zorunlu olur — erken patlamak yerine doğru anda patlarlar.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Repo kökünü bul (pnpm-workspace.yaml'ı arayarak yukarı yürü). */
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
/** .env'i repo kökünden bir kez yükle. Zaten set edilmiş process env'i ezmez. */
export function loadDotenv(): void {
  if (loaded) return;
  const envPath = resolve(repoRoot(), '.env');
  if (existsSync(envPath)) dotenv.config({ path: envPath });
  loaded = true;
}

// ---------------------------------------------------------------------------
// Alan doğrulayıcıları
// ---------------------------------------------------------------------------

const hexPrivKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, '0x + 64 hex hane olmalı (32-byte secp256k1 private key)');

const httpUrl = z.string().url('geçerli bir http(s) URL olmalı');

const hederaAccountId = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Hedera hesap kimliği shard.realm.num biçiminde olmalı (ör. 0.0.12345)');

const evmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, '0x + 40 hex hane olmalı (EVM adresi)');

/** Zorunlu (P0-A'da dolu olmalı) env şeması. */
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
  HEDERA_OPERATOR_KEY: z.string().min(1, 'boş olamaz (DER veya hex private key)'),
  HEDERA_NETWORK: z.enum(['testnet', 'previewnet', 'mainnet']),
  BLOCKY402_URL: httpUrl,
  BLOCKY402_FEE_PAYER: hederaAccountId,

  // --- Mod anahtarları (BUILD-PLAN P0-A) ---
  MOCK_0G: z.enum(['0', '1']).default('0'),
  FRAUD_MODE: z.enum(['none', 'substitute', 'tamper', 'forge', 'selfintent']).default('none'),
});

export type CoreConfig = z.infer<typeof coreSchema>;

/** Sonraki fazlarda dolan, kullanıldığı anda zorunlu olan alanlar. */
const LATER_KEYS = [
  'VERIFIER_ADDRESS',
  'ALICE_AGENT_ID',
  'BOB_AGENT_ID',
  'OG_PROVIDER_ADDRESS',
  'OG_TAPP_ENDPOINT',
  'OG_AGENT_ID',
  'HEDERA_TOPIC_ID',
  'GRAPH_DEPLOY_KEY',
  'SUBGRAPH_SLUG',
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
    const key = i.path.join('.') || '(kök)';
    const missing = i.code === 'invalid_type' && (i as { received?: string }).received === 'undefined';
    return missing ? `  ✗ ${key} — EKSİK (.env'de tanımlı değil ya da boş)` : `  ✗ ${key} — ${i.message}`;
  });
  return [
    `.env doğrulaması başarısız — ${issues.length} alan hatalı:`,
    ...lines,
    '',
    `Şablon: ${resolve(repoRoot(), '.env.example')}`,
  ].join('\n');
}

let cached: CoreConfig | undefined;

/**
 * Zorunlu env'i doğrula ve döndür. Eksik/hatalı alanı ADIYLA raporlar.
 * @param source test edilebilirlik için env kaynağı (varsayılan: process.env)
 */
export function loadConfig(source?: NodeJS.ProcessEnv): CoreConfig {
  if (!source && cached) return cached;
  if (!source) loadDotenv();

  const env = source ?? process.env;
  // Boş string'i "eksik" say — `FOO=` yazmak alanı doldurmuş sayılmaz.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.trim() !== '') cleaned[k] = v.trim();
  }

  const parsed = coreSchema.safeParse(cleaned);
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error.issues));

  if (!source) cached = parsed.data;
  return parsed.data;
}

/** Sonraki fazda dolan bir alanı kullanıldığı anda zorunlu kıl. */
export function requireEnv(key: LaterKey, hint?: string): string {
  loadDotenv();
  const v = process.env[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ConfigError(
      `.env alanı EKSİK: ${key}${hint ? ` — ${hint}` : ''}\n` +
        `Bu alan bir sonraki fazda doluyor; şu an ona bağlı bir kod çalıştırdın.`,
    );
  }
  return v.trim();
}

/** Opsiyonel alan — yoksa undefined. */
export function optionalEnv(key: LaterKey): string | undefined {
  loadDotenv();
  const v = process.env[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** `.env.example`'daki tüm anahtar isimleri — kapı testi bunu .env ile karşılaştırır. */
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
