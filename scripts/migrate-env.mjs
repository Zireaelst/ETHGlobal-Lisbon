// scripts/migrate-env.mjs — eski (CLAUDE.md §6) env isimlerini BUILD-PLAN P0-A isimlerine taşır.
// Değerleri hiçbir yere BASMAZ; sadece anahtar adlarını yeniden yazar ve .env.bak yedeği bırakır.
// Tek seferlik; ikinci çalıştırmada zaten taşınmış alanları atlar.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');

if (!existsSync(envPath)) {
  console.error('.env yok — .env.example dosyasını kopyalayıp doldurun.');
  process.exit(1);
}

const RENAME = {
  ALICE_PRIVATE_KEY: 'PRIVATE_KEY_ALICE',
  BOB_PRIVATE_KEY: 'PRIVATE_KEY_BOB',
  DEPLOYER_PRIVATE_KEY: 'PRIVATE_KEY_DEPLOYER',
  ZG_RPC_URL: 'OG_RPC_URL',
  ZG_COMPUTE_PROVIDER: 'OG_PROVIDER_ADDRESS',
  HEDERA_ACCOUNT_ID: 'HEDERA_OPERATOR_ID',
  HEDERA_PRIVATE_KEY: 'HEDERA_OPERATOR_KEY',
  X402_FACILITATOR_URL: 'BLOCKY402_URL',
  BASE_SEPOLIA_RPC_URL: 'BASE_RPC_URL',
  ERC8004_REGISTRY_ADDR: 'ERC8004_IDENTITY',
  VERIFIER_ADDR: 'VERIFIER_ADDRESS',
  SUBGRAPH_STUDIO_DEPLOY_KEY: 'GRAPH_DEPLOY_KEY',
};

/** `KEY=value  # comment` satırından KEY ve değeri ayır (satır içi yorumu at). */
function parseLine(line) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (!m) return null;
  let value = m[2];
  const hash = value.indexOf('#');
  if (hash >= 0) value = value.slice(0, hash);
  return { key: m[1], value: value.trim() };
}

const existing = new Map();
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const p = parseLine(line.trim());
  if (p) existing.set(p.key, p.value);
}

// Yeniden adlandır: yeni isim boşsa eski değeri taşı.
const renamed = [];
for (const [oldKey, newKey] of Object.entries(RENAME)) {
  const oldVal = existing.get(oldKey);
  if (oldVal && !existing.get(newKey)) {
    existing.set(newKey, oldVal);
    renamed.push(`${oldKey} -> ${newKey}`);
  }
  existing.delete(oldKey);
}

// .env.example'ın sıra ve yorumlarını koruyarak yeniden yaz; değerler .env'den gelir.
const out = [];
const written = new Set();
for (const rawLine of readFileSync(examplePath, 'utf8').split('\n')) {
  const line = rawLine.trimEnd();
  const p = parseLine(line.trim());
  if (!p) {
    out.push(line);
    continue;
  }
  const value = existing.has(p.key) && existing.get(p.key) !== '' ? existing.get(p.key) : p.value;
  out.push(`${p.key}=${value}`);
  written.add(p.key);
}

// .env'de olup .example'da olmayan alanları kaybetme.
const orphans = [...existing.keys()].filter((k) => !written.has(k) && existing.get(k) !== '');
if (orphans.length) {
  out.push('', '# --- .env.example dışında kalan alanlar (taşındı, gözden geçirin) ---');
  for (const k of orphans) out.push(`${k}=${existing.get(k)}`);
}

copyFileSync(envPath, resolve(root, '.env.bak'));
writeFileSync(envPath, out.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');

console.log(`.env taşındı (yedek: .env.bak). ${renamed.length} alan yeniden adlandırıldı:`);
for (const r of renamed) console.log(`  ${r}`);
if (orphans.length) console.log(`Şablon dışı korunan alanlar: ${orphans.join(', ')}`);
