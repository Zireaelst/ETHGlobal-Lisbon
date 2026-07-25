// tests/gates/_env-write.ts — a small helper for updating, in place, the values the gate scripts
// produce (the topic id in .env, a deployed contract address, and so on).
// It preserves comments and ordering, and it NEVER LOGS the values.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../../packages/shared/src/config.js';

/** Set a field in .env. Appends to the end of the file when the field is absent. */
export function setEnvValue(key: string, value: string): void {
  const path = resolve(repoRoot(), '.env');
  const text = readFileSync(path, 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
  writeFileSync(path, next, 'utf8');
  process.env[key] = value;
}
