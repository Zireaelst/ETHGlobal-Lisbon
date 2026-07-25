// scripts/og-probe-echo.ts — Level 0 fizibilite deneyi.
//
// SORU: intentHash'i prompt'a koyup modelden çıktısında AYNEN tekrarlamasını
// istersek, model bunu güvenilir şekilde yapar mı — ve o çıktı 0G TEE imzasının
// kapsamına girer mi?
//
// Bu, "yapabilir miyiz" sorusunun belgeyle değil DENEYLE cevabı. 5 koşu yapıp
// kaç tanesinde hash'in tam ve bozulmadan çıktığına bakıyoruz. Model 64 karakterlik
// bir hex diziyi tekrarlarken tek karakter kaydırırsa fikir çöker — o yüzden
// "yaklaşık doğru" saymıyoruz, birebir arıyoruz.

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
  // Her turda FARKLI bir intentHash — model ezberleyemesin.
  const intentHash = ethers.keccak256(ethers.toUtf8Bytes(`intent/${i}/${Date.now()}`));

  // Talimatı çıktının EN BAŞINA sabitliyoruz: sonda olsa model uzun cevaplarda
  // kırpabilir; başta olması hem kesme riskini hem "unuttu" riskini azaltıyor.
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
    results.push(`tur ${i + 1}: HTTP ${res.status}`);
    continue;
  }

  const rawResponseText = await res.text();
  const completion = JSON.parse(rawResponseText) as { choices?: Array<{ message?: { content?: string } }> };
  const output = completion.choices?.[0]?.message?.content ?? '';
  const chatID = res.headers.get('ZG-Res-Key');

  // 1) Hash çıktıda BİREBİR geçiyor mu?
  const echoed = output.includes(intentHash);

  // 2) TEE imzası bu yanıtı kapsıyor mu?
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
    `tur ${i + 1}: tekrar=${echoed ? 'EVET' : 'HAYIR'} · imza-kapsıyor=${covers} · imzacı=${signerOk} ` +
      `${good ? '✅' : '❌'}${echoed ? '' : `\n   çıktı başı: ${JSON.stringify(output.slice(0, 100))}`}`,
  );
}

console.log(results.join('\n'));
console.log(`\nSONUÇ: ${ok}/${ROUNDS} turda zincir tam kuruldu.`);
console.log(
  ok === ROUNDS
    ? 'Level 0 uygulanabilir: model sipariş numarasını birebir taşıyor ve TEE imzası onu kapsıyor.'
    : 'DİKKAT: tekrar güvenilir değil — talimat güçlendirilmeli ya da fikir gözden geçirilmeli.',
);
