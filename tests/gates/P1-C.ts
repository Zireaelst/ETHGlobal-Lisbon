// tests/gates/P1-C.ts — alice-agent + bob-agent iskeletleri kapısı.
//
// BUILD-PLAN P1-C geçiş kriterleri:
//   [ ] Uçtan uca: Alice gizli brief gönderir, Bob DÜZ METNİ DOĞRU ÇÖZER
//   [ ] Bob'un recompute ettiği intentHash === Alice'in imzaladığı
//   [ ] Alice tek karakter değiştirip gönderdiğinde Bob match:false döner
//   [ ] Ağ dinlemesi kanıtı: yakalanan trafikte brief metni geçmiyor
//   [ ] Bozuk zod şeması olan istek 400 ile reddediliyor, 500 ile çökmüyor
//
// Ağa çıkmaz (localhost). 0G/faucet durumundan bağımsız koşar.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

import { createBobAgent, type BobAgent } from '../../packages/bob-agent/src/index.js';
import { runAliceJob } from '../../packages/alice-agent/src/index.js';
import {
  PLACEHOLDER_VERIFIER,
  createEciesIdentity,
  eciesPublicKeyOf,
  encryptFor,
  type Constraints,
} from '../../packages/shared/src/index.js';
import { loadDotenv, optionalEnv, repoRoot } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';
import { startRecordingProxy, type RecordingProxy } from './_recording-proxy.js';

loadDotenv();
const root = repoRoot();
const gate = new Gate('P1-C', 'Alice ↔ Bob gizli mesajlaşma (echo)');

// Verifier deploy edildiyse GERÇEK adresi kullan — imzalar üretim domain'inde üretilsin.
const VERIFYING_CONTRACT = optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER;

// Gizli iş — bu metnin ağa DÜZ olarak çıkmaması kapının konusu.
const SECRET_BRIEF =
  'CONFIDENTIAL-BRIEF-ACME-ALPHA: assess revenue-recognition risk in the attached quarterly figures.';
const SECRET_DATA =
  'CONFIDENTIAL-DATA-ACME-ALPHA: Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR; 41 contracts.';
const CONSTRAINTS: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };

const BOB_AGENT_ID = optionalEnv('BOB_AGENT_ID') ?? '8429';
const aliceEcies = optionalEnv('ALICE_ECIES_PRIV') ?? createEciesIdentity().privateKey;
const bobEcies = optionalEnv('BOB_ECIES_PRIV') ?? createEciesIdentity().privateKey;
const aliceWallet = Wallet.createRandom();
const bobWallet = Wallet.createRandom();
/** FAZ 1 binding anahtarı — enclave seal key DEĞİL (P3-C değiştirecek). */
const BINDING_KEY = keccak256(toUtf8Bytes('confidential-agents/P1-C/binding'));
/** Şema doğrulaması için geçerli biçimli, anlamsız bir taahhüt. */
const ZERO_HASH = '0x' + '00'.repeat(32);

let bob: BobAgent | undefined;
let proxy: RecordingProxy | undefined;
/** Bob'un gerçekten çözdüğü düz metin — onDecrypted kancasından.  */
const decryptedByBob: Array<{ brief: string; data: string; nonce: string }> = [];

gate.check('Bob ayağa kalkıyor ve agent-card şemadan geçiyor', async () => {
  bob = createBobAgent({
    eciesPrivateKey: bobEcies,
    agentId: BOB_AGENT_ID,
    owner: bobWallet.address,
    skills: ['market-analysis'],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract: VERIFYING_CONTRACT,
    bindingKey: BINDING_KEY,
    log: () => {}, // kapı çıktısını kirletme
    onDecrypted: (e) => decryptedByBob.push({ brief: e.brief, data: e.data, nonce: e.nonce }),
  });
  await bob.listen();
  proxy = await startRecordingProxy(bob.url());

  const res = await fetch(`${proxy.url()}/.well-known/agent-card.json`);
  if (res.status !== 200) return fail(`agent-card HTTP ${res.status}`);
  const card = bob.card(); // createBobAgent zaten AgentCardSchema'dan geçiriyor
  return pass(
    [
      `agentId ${card.agentId} · skills ${card.skills.join(',')}`,
      `eciesPubKey ${card.eciesPubKey.slice(0, 20)}…`,
      `proxy (gözlemci) ${proxy.url()} → bob ${bob.url()}`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 1. Dürüst iş — uçtan uca
// ---------------------------------------------------------------------------
let honestIntentHash = '';

gate.check('Uçtan uca: Alice gönderir, Bob düz metni DOĞRU çözer', async () => {
  if (!proxy) return fail('proxy yok');
  const report = await runAliceJob({
    bobUrl: proxy.url(), // gözlemcinin içinden geçiyoruz
    brief: SECRET_BRIEF,
    data: SECRET_DATA,
    constraints: CONSTRAINTS,
    wallet: aliceWallet,
    eciesPrivateKey: aliceEcies,
    verifyingContract: VERIFYING_CONTRACT,
    nonce: 7n,
    log: () => {},
  });
  honestIntentHash = report.intent.intentHash;

  const seen = decryptedByBob.at(-1);
  if (!seen) return fail('Bob hiçbir paket çözmedi');
  if (seen.brief !== SECRET_BRIEF) return fail('Bob\'un çözdüğü brief gönderilenden farklı');
  if (seen.data !== SECRET_DATA) return fail('Bob\'un çözdüğü data gönderilenden farklı');
  if (report.postStatus !== 202) return fail(`/task ${report.postStatus} döndü`);

  return pass(
    [
      `Bob brief'i byte-identik çözdü (${seen.brief.length} karakter)`,
      `Bob data'yı byte-identik çözdü (${seen.data.length} karakter)`,
      `şifreli gövde ${(report.sentCipher.length / 1024).toFixed(1)} KB`,
    ].join('\n'),
  );
});

gate.check('Bob\'un recompute ettiği intentHash === Alice\'in imzaladığı', async () => {
  if (!bob) return fail('bob yok');
  const last = bob.processed.at(-1);
  if (!last) return fail('işlenmiş iş yok');
  if (last.recomputedIntentHash !== honestIntentHash) {
    return fail(`Alice ${honestIntentHash}\nBob   ${last.recomputedIntentHash}`);
  }
  return last.match ? pass(`${honestIntentHash} · match=true`) : fail('hash aynı ama match=false');
});

gate.check('Alice\'in EIP-712 imzası Bob tarafında Alice\'i veriyor', () => {
  if (!bob) return fail('bob yok');
  const last = bob.processed.at(-1);
  if (!last) return fail('işlenmiş iş yok');
  return last.clientSigOk && last.recoveredClient.toLowerCase() === aliceWallet.address.toLowerCase()
    ? pass(`kurtarılan ${last.recoveredClient}`)
    : fail(`clientSigOk=${last.clientSigOk} kurtarılan=${last.recoveredClient}`);
});

// ---------------------------------------------------------------------------
// 2. Tek karakter değişimi
// ---------------------------------------------------------------------------
gate.check('Tek karakter değişince Bob match:false döndürüyor', async () => {
  if (!proxy) return fail('proxy yok');
  const report = await runAliceJob({
    bobUrl: proxy.url(),
    brief: SECRET_BRIEF,
    data: SECRET_DATA,
    constraints: CONSTRAINTS,
    wallet: aliceWallet,
    eciesPrivateKey: aliceEcies,
    verifyingContract: VERIFYING_CONTRACT,
    nonce: 8n,
    // İmza atıldıktan SONRA brief'in bir karakterini değiştir — saldırganın yapacağı şey.
    tamper: (envelope) => ({ ...envelope, brief: `${SECRET_BRIEF.slice(0, -1)}X` }),
    log: () => {},
  });

  if (report.result.match) return fail('brief değiştiği hâlde match=true');
  if (report.result.recomputedIntentHash === report.intent.intentHash) {
    return fail('brief değiştiği hâlde yeniden hesaplanan hash aynı çıktı');
  }
  return pass(
    [
      `imzalanan  ${report.intent.intentHash.slice(0, 22)}…`,
      `hesaplanan ${report.result.recomputedIntentHash.slice(0, 22)}…`,
      'match=false — sipariş edilen iş değil',
    ].join('\n'),
  );
});

gate.check('Data\'nın tek byte\'ı değişince de match:false', async () => {
  if (!proxy) return fail('proxy yok');
  const report = await runAliceJob({
    bobUrl: proxy.url(),
    brief: SECRET_BRIEF,
    data: SECRET_DATA,
    constraints: CONSTRAINTS,
    wallet: aliceWallet,
    eciesPrivateKey: aliceEcies,
    verifyingContract: VERIFYING_CONTRACT,
    nonce: 9n,
    tamper: (envelope) => ({ ...envelope, data: SECRET_DATA.replace('12,400,000', '12,400,001') }),
    log: () => {},
  });
  return report.result.match ? fail('data değiştiği hâlde match=true') : pass('tampering yakalanıyor');
});

// ---------------------------------------------------------------------------
// 3. Ağ dinlemesi kanıtı
// ---------------------------------------------------------------------------
gate.check('Yakalanan trafikte brief/data düz metni GEÇMİYOR', () => {
  if (!proxy) return fail('proxy yok');
  const captured = proxy.captured();
  const asUtf8 = captured.toString('utf8');
  const asHex = captured.toString('hex');

  const hits: string[] = [];
  for (const [label, secret] of [
    ['brief', SECRET_BRIEF],
    ['data', SECRET_DATA],
  ] as const) {
    // (a) düz metin olarak
    for (let i = 0; i + 16 <= secret.length; i += 16) {
      const w = secret.slice(i, i + 16);
      if (asUtf8.includes(w)) hits.push(`${label}: düz metin "${w}"`);
    }
    // (b) hex kodlanmış olarak (gövde hex cipher, asıl risk bu)
    const hex = Buffer.from(secret, 'utf8').toString('hex');
    for (let i = 0; i + 32 <= hex.length; i += 32) {
      const w = hex.slice(i, i + 32);
      if (asHex.includes(w)) hits.push(`${label}: hex "${w}"`);
    }
  }

  // Kanıt dökümünü diske yaz — demo videosunun "gözlemcinin gördüğü" paneli için.
  const dir = resolve(root, 'fixtures/p1c');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'observed-traffic.txt'),
    proxy.exchanges
      .map(
        (e) =>
          `${e.method} ${e.path} -> ${e.status}\n` +
          `  istek : ${e.requestBody.length} byte  ${e.requestBody.toString('utf8').slice(0, 220)}…\n` +
          `  yanıt : ${e.responseBody.length} byte  ${e.responseBody.toString('utf8').slice(0, 220)}…\n`,
      )
      .join('\n'),
    'utf8',
  );

  if (hits.length) return fail(hits.slice(0, 5).join('\n'));
  return pass(
    [
      `${proxy.exchanges.length} istek/yanıt, toplam ${(captured.length / 1024).toFixed(1)} KB yakalandı`,
      'brief ve data hiçbir pencerede geçmiyor (düz metin + hex)',
      'döküm: fixtures/p1c/observed-traffic.txt',
    ].join('\n'),
  );
});

gate.check('Gözlemci /task gövdesinde SADECE taahhüt ve şifreli blob görüyor', () => {
  if (!proxy) return fail('proxy yok');
  const task = proxy.exchanges.find((e) => e.path === '/task');
  if (!task) return fail('/task isteği yakalanmadı');
  const body = JSON.parse(task.requestBody.toString('utf8')) as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.join(',') !== 'cipher,intentHash,replyPubKey,to') {
    return fail(`/task gövdesinde beklenmeyen alanlar: ${keys.join(',')}`);
  }

  // Yanıt da `match` sızdırmamalı — sonuç şifrelenmiş pakette.
  const response = JSON.parse(task.responseBody.toString('utf8')) as Record<string, unknown>;
  if ('match' in response) return fail('/task yanıtı `match`i düz metin sızdırıyor');
  return pass(`istek alanları: ${keys.join(', ')} · yanıt: ${Object.keys(response).join(', ')}`);
});

// ---------------------------------------------------------------------------
// 4. Hatalı istekler — 400, asla 500
// ---------------------------------------------------------------------------
gate.check('Bozuk istekler 400/404 ile reddediliyor, 500 ile çökmüyor', async () => {
  if (!bob || !proxy) return fail('sunucu yok');
  const base = proxy.url();
  const post = (body: string) =>
    fetch(`${base}/task`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

  const foreignKey = createEciesIdentity();
  const bobPub = eciesPublicKeyOf(bobEcies);

  const cases: Array<[string, () => Promise<Response>, number[]]> = [
    ['JSON değil', () => post('bu json değil'), [400]],
    ['alanları eksik gövde', () => post(JSON.stringify({ hello: 'world' })), [400]],
    ['boş cipher', () => post(JSON.stringify({ to: BOB_AGENT_ID, intentHash: ZERO_HASH, replyPubKey: eciesPublicKeyOf(aliceEcies), cipher: '' })), [400]],
    ['bozuk cipher', () => post(JSON.stringify({ to: BOB_AGENT_ID, intentHash: ZERO_HASH, replyPubKey: eciesPublicKeyOf(aliceEcies), cipher: 'deadbeef' })), [400]],
    [
      'başka agent\'a gönderilmiş',
      () =>
        post(
          JSON.stringify({
            to: '999999',
            intentHash: ZERO_HASH,
            replyPubKey: eciesPublicKeyOf(aliceEcies),
            cipher: 'deadbeef',
          }),
        ),
      [404],
    ],
    [
      'başkasının anahtarıyla şifrelenmiş',
      async () =>
        post(
          JSON.stringify({
            to: BOB_AGENT_ID,
            intentHash: ZERO_HASH,
            replyPubKey: eciesPublicKeyOf(aliceEcies),
            cipher: await encryptFor(foreignKey.publicKey, { v: 1 }),
          }),
        ),
      [400],
    ],
    [
      'şemadan geçmeyen paket (doğru anahtarla şifreli)',
      async () =>
        post(
          JSON.stringify({
            to: BOB_AGENT_ID,
            intentHash: ZERO_HASH,
            replyPubKey: eciesPublicKeyOf(aliceEcies),
            cipher: await encryptFor(bobPub, { v: 1, brief: 42, nonce: 'abc' }),
          }),
        ),
      [400],
    ],
    ['bilinmeyen intentHash için sonuç', () => fetch(`${base}/result/0x${'00'.repeat(32)}`), [404]],
  ];

  const problems: string[] = [];
  const lines: string[] = [];
  for (const [name, run, expected] of cases) {
    const res = await run();
    const ok = expected.includes(res.status);
    lines.push(`${ok ? '✓' : '✗'} ${name.padEnd(38)} → ${res.status}`);
    if (!ok) problems.push(`${name}: beklenen ${expected.join('/')}, gelen ${res.status}`);
  }

  // Sunucu hâlâ ayakta mı? (500 ile çöküp çökmediğinin gerçek testi)
  const health = await fetch(`${base}/health`);
  lines.push(`${health.status === 200 ? '✓' : '✗'} sunucu hâlâ ayakta`.padEnd(42) + ` → ${health.status}`);
  if (health.status !== 200) problems.push('bozuk isteklerden sonra /health cevap vermiyor');

  return problems.length === 0 ? pass(lines.join('\n')) : fail(`${lines.join('\n')}\n\n${problems.join('\n')}`);
});

gate.check('Sonuç sadece Alice\'in anahtarıyla çözülüyor', async () => {
  if (!proxy) return fail('proxy yok');
  const res = await fetch(`${proxy.url()}/result/${honestIntentHash}`);
  if (!res.ok) return fail(`/result HTTP ${res.status}`);
  const { cipher } = (await res.json()) as { cipher: string };

  const { decryptWith } = await import('../../packages/shared/src/ecies.js');
  const intruder = createEciesIdentity();
  try {
    await decryptWith(intruder.privateKey, cipher);
    return fail('yabancı anahtar sonucu çözdü');
  } catch {
    // beklenen
  }
  const mine = await decryptWith<{ match: boolean }>(aliceEcies, cipher);
  return mine.match ? pass('Alice çözüyor, yabancı çözemiyor') : fail('Alice çözdü ama match=false');
});

gate.check('Sunucular kapatıldı', async () => {
  await proxy?.close();
  await bob?.close();
  return pass('proxy ve bob kapandı');
});

await gate.run();
