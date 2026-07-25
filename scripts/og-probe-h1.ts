// scripts/og-probe-h1.ts — imzalı demetteki h1 ve h3 NE?
//
// Neden önemli: demet "<h1>:<sha256(yanıt)>:<tip>:<kimlik>:<h3>". h2'nin yanıt
// olduğunu biliyoruz. h1 koşudan koşuya DEĞİŞİYOR (isteğe bağlı), h3 SABİT.
//
// Eğer h1 === sha256(gönderdiğimiz istek gövdesi) ise, 0G TEE'si istek↔yanıt
// bağını KENDİSİ imzalıyor demektir. O zaman intentHash'i prompt'a koyduğumuzda
// bağlama attested TEE'nin içine girer — kendi TDX makinemiz olmadan.
//
// Bu yüzden burada isteğin TAM baytlarını saklayıp h1'i ona karşı deniyoruz.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';
import { loadDotenv, repoRoot, requireEnv } from '../packages/shared/src/config.js';

const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

loadDotenv();
const root = repoRoot();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const signerFixture = JSON.parse(
  readFileSync(resolve(root, 'fixtures/og/signer.json'), 'utf8'),
) as { provider: string; model: string; url: string };

const provider = new ethers.JsonRpcProvider(requireEnv('OG_RPC_URL'));
const wallet = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);
const broker = await createZGComputeNetworkBroker(wallet);

const { endpoint, model } = await broker.inference.getServiceMetadata(signerFixture.provider);
const headers = (await broker.inference.getRequestHeaders(signerFixture.provider)) as Record<string, string>;

// TAM baytları elimizde tutuyoruz — sonradan yeniden serileştirmek anahtar
// sırasını değiştirebilir ve karşılaştırmayı sessizce bozar.
const requestBytes = JSON.stringify({
  model,
  messages: [{ role: 'user', content: 'Reply with the single word: bound.' }],
});

const res = await fetch(`${endpoint}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: requestBytes,
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

const rawResponseText = await res.text();
const chatID = res.headers.get('ZG-Res-Key');
const sigRes = await fetch(`${signerFixture.url}/v1/proxy/signature/${chatID}?model=${signerFixture.model}`, {
  headers: { 'Content-Type': 'application/json' },
});
const sig = (await sigRes.json()) as { text: string; signature: string };
const [h1, h2, ptype, pid, h3] = sig.text.split(':');

console.log(`demet: ${sig.text}\n`);
console.log(`h2 === sha256(ham yanıt)?  ${h2 === sha(rawResponseText)}`);
console.log(`\nh1 = ${h1}`);

const messagesOnly = JSON.stringify([{ role: 'user', content: 'Reply with the single word: bound.' }]);
const promptOnly = 'Reply with the single word: bound.';

const candidates: Record<string, string> = {
  'sha256(gönderilen ham istek)': sha(requestBytes),
  'sha256(messages dizisi)': sha(messagesOnly),
  'sha256(sadece prompt metni)': sha(promptOnly),
  'sha256(model)': sha(model),
  'sha256(chatID)': sha(chatID ?? ''),
  'sha256(istek + model başlığı)': sha(`${model}${requestBytes}`),
  'sha256(ham istek + ham yanıt)': sha(requestBytes + rawResponseText),
};

let hit = false;
for (const [name, value] of Object.entries(candidates)) {
  const m1 = value === h1;
  const m3 = value === h3;
  if (m1 || m3) {
    hit = true;
    console.log(`  ✅ ${m1 ? 'h1' : 'h3'} === ${name}`);
  }
}
if (!hit) console.log('  (hiçbir aday tutmadı)');

console.log(`\nh3 = ${h3}   (önceki koşularla aynıysa SABİT bir kimlik)`);
console.log(`sağlayıcı tipi/kimliği: ${ptype}/${pid}`);
console.log(`\nisteğin ham baytları (${requestBytes.length} b):\n${requestBytes}`);
