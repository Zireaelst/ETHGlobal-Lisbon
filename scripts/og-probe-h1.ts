// scripts/og-probe-h1.ts — WHAT are h1 and h3 in the signed tuple?
//
// Why it matters: the tuple is "<h1>:<sha256(response)>:<type>:<identity>:<h3>". We know h2 is
// the response. h1 CHANGES from run to run (request-dependent); h3 is CONSTANT.
//
// If h1 === sha256(the request body we sent), then the 0G TEE is signing the request↔response
// binding ITSELF. In that case putting the intentHash in the prompt moves the binding inside the
// attested TEE — without a TDX machine of our own.
//
// So here we keep the EXACT bytes of the request and test h1 against them.

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

// We hold on to the EXACT bytes — re-serialising later could change key order and silently break
// the comparison.
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

console.log(`tuple: ${sig.text}\n`);
console.log(`h2 === sha256(raw response)?  ${h2 === sha(rawResponseText)}`);
console.log(`\nh1 = ${h1}`);

const messagesOnly = JSON.stringify([{ role: 'user', content: 'Reply with the single word: bound.' }]);
const promptOnly = 'Reply with the single word: bound.';

const candidates: Record<string, string> = {
  'sha256(raw request as sent)': sha(requestBytes),
  'sha256(messages array)': sha(messagesOnly),
  'sha256(prompt text only)': sha(promptOnly),
  'sha256(model)': sha(model),
  'sha256(chatID)': sha(chatID ?? ''),
  'sha256(request + model prefix)': sha(`${model}${requestBytes}`),
  'sha256(raw request + raw response)': sha(requestBytes + rawResponseText),
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
if (!hit) console.log('  (no candidate matched)');

console.log(`\nh3 = ${h3}   (if identical to earlier runs, it is a CONSTANT identity)`);
console.log(`provider type/identity: ${ptype}/${pid}`);
console.log(`\nraw request bytes (${requestBytes.length} b):\n${requestBytes}`);
