// tests/gates/_env-write.ts — kapı script'lerinin ürettiği değerleri (.env'deki topic id,
// deploy edilen kontrat adresi vb.) yerinde güncellemek için küçük yardımcı.
// Yorumları ve sırayı korur; değerleri LOGLAMAZ.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../../packages/shared/src/config.js';

/** .env'de bir alanı ayarla. Alan yoksa dosyanın sonuna ekler. */
export function setEnvValue(key: string, value: string): void {
  const path = resolve(repoRoot(), '.env');
  const text = readFileSync(path, 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
  writeFileSync(path, next, 'utf8');
  process.env[key] = value;
}
