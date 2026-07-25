// scripts/og-probe-echo.ts — the Level 0 feasibility experiment.
//
// THE QUESTION: if we put the intentHash in the prompt and ask the model to reproduce it
// VERBATIM in its output, does it do so reliably — and does that output fall within the scope of
// the 0G TEE signature?
//
// This answers "can we do it" BY EXPERIMENT rather than by documentation. We make 5 runs and
// check in how many the hash comes out complete and uncorrupted. If the model shifts a single
// character while reproducing a 64-character hex string, the idea collapses — so we do not accept
// "approximately right", we require an exact match.

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

const ROUNDS = 5;

const signerFixture = JSON.parse(
  readFileSync(resolve(root, 'fixtures/og/signer.json'), 'utf8'),
) as { provider: string; model: string; url: string; expectedSigner: string };

const provider = new ethers.JsonRpcProvider(requireEnv('OG_RPC_URL'));
const wallet = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);
const broker = await createZGComputeNetworkBroker(wallet);
const { endpoint, model } = await broker.inference.getServiceMetadata(signerFixture.provider);

const BRIEF = 'Summarise the covenant risk in the attached filing in three sentences.';
const DATA = 'ACME Corp Q3-2026: revenue 41.2M, deferred revenue up 38% QoQ, DSO 71 days.';

let ok = 0;
const results: string[] = [];

for (let i = 0; i < ROUNDS; i += 1) {
  // A DIFFERENT intentHash each round — so the model cannot memorise it.
  const intentHash = ethers.keccak256(ethers.toUtf8Bytes(`intent/${i}/${Date.now()}`));

  // We pin the instruction to the VERY TOP of the output: at the end, a long answer could be
  // truncated; putting it first reduces both the truncation risk and the "it forgot" risk.
  const prompt = [
    `ORDER-ID: ${intentHash}`,
    '',
    'Begin your reply with exactly this line, copied character for character:',
    `ORDER-ID: ${intentHash}`,
    '',
    'Then answer the brief below.',
    '',
    `BRIEF:\n${BRIEF}`,
    '',
    `DATA:\n${DATA}`,
  ].join('\n');

  const headers = (await broker.inference.getRequestHeaders(signerFixture.provider)) as Record<string, string>;
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 400 }),
  });
  if (!res.ok) {
    results.push(`round ${i + 1}: HTTP ${res.status}`);
    continue;
  }

  const rawResponseText = await res.text();
  const completion = JSON.parse(rawResponseText) as { choices?: Array<{ message?: { content?: string } }> };
  const output = completion.choices?.[0]?.message?.content ?? '';
  const chatID = res.headers.get('ZG-Res-Key');

  // 1) Does the hash appear VERBATIM in the output?
  const echoed = output.includes(intentHash);

  // 2) Does the TEE signature cover this response?
  const sigRes = await fetch(
    `${signerFixture.url}/v1/proxy/signature/${chatID}?model=${signerFixture.model}`,
    { headers: { 'Content-Type': 'application/json' } },
  );
  const sig = (await sigRes.json()) as { text: string; signature: string };
  const covers = sig.text.split(':').includes(sha(rawResponseText));
  const signer = ethers.verifyMessage(sig.text, sig.signature);
  const signerOk = signer.toLowerCase() === signerFixture.expectedSigner.toLowerCase();

  const good = echoed && covers && signerOk;
  if (good) ok += 1;
  results.push(
    `round ${i + 1}: echoed=${echoed ? 'YES' : 'NO'} · signature-covers=${covers} · signer=${signerOk} ` +
      `${good ? '✅' : '❌'}${echoed ? '' : `\n   start of output: ${JSON.stringify(output.slice(0, 100))}`}`,
  );
}

console.log(results.join('\n'));
console.log(`\nRESULT: the chain was fully established in ${ok}/${ROUNDS} rounds.`);
console.log(
  ok === ROUNDS
    ? 'Level 0 is viable: the model carries the order id verbatim and the TEE signature covers it.'
    : 'WARNING: the echo is not reliable — the instruction must be strengthened or the idea reconsidered.',
);
