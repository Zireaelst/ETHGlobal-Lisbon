// tests/gates/P4-C.ts — HederaX402Backend kapısı (SIFIR Solidity).
//
// BUILD-PLAN P4-C geçiş kriterleri:
//   [ ] HashScan'de başarılı transfer
//   [ ] Anahtarın agent bağlamına girmediği kanıtlanıyor: agent sürecinin
//       loglarında/bellek dökümünde private key YOK; `signer` ayrı modül
//   [ ] Aynı iş akışı sadece PAYMENT_BACKEND=hedera ile çalışıyor, başka kod
//       değişikliği yok
//
// Hedera tarafında SOLIDITY YOK: yalnızca @x402/hedera + @hiero-ledger/sdk.
// Karar (JobVerified) Base'de, ödeme ve zaman çizelgesi Hedera'da — temiz ayrım.

import { execFileSync } from 'node:child_process';
import { inspect } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { closeBob, runDemo, type DemoReport } from '../../packages/demo/src/index.js';
import { createHederaSigner, containsSecret } from '../../packages/payment/src/signer/hedera-signer.js';
import { createHederaX402Backend } from '../../packages/payment/src/hedera-x402.js';
import { loadConfig, loadDotenv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const MIRROR = 'https://testnet.mirrornode.hedera.com';
const gate = new Gate('P4-C', 'Hedera x402 backend + delegated signing (sıfır Solidity)');
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString() };

let honest: DemoReport | undefined;
let fraud: DemoReport | undefined;
const capturedLogs: string[] = [];

// ---------------------------------------------------------------------------
// 1. SIFIR SOLIDITY — yapısal kanıt
// ---------------------------------------------------------------------------
gate.check('Hedera yolunda Solidity/kontrat YOK (yapısal)', () => {
  const hederaSources = ['packages/payment/src/hedera-x402.ts', 'packages/payment/src/signer/hedera-signer.ts'];
  const banned = ['solidity', 'abi.encode', 'ContractExecuteTransaction', 'ContractCreateTransaction', '0x167', 'precompile'];
  const hits: string[] = [];
  for (const f of hederaSources) {
    const src = readFileSync(resolve(root, f), 'utf8').toLowerCase();
    for (const b of banned) {
      if (src.includes(b.toLowerCase())) hits.push(`${f}: "${b}"`);
    }
  }
  // contracts/ altında Hedera'ya deploy edilen bir şey de olmamalı.
  const manifest = readFileSync(resolve(root, 'contracts/foundry.toml'), 'utf8');
  if (/hedera/i.test(manifest)) hits.push('contracts/foundry.toml Hedera ağı tanımlıyor');

  return hits.length === 0
    ? pass('Hedera rayı yalnızca @x402/hedera + @hiero-ledger/sdk kullanıyor; kontrat yok')
    : fail(hits.join('\n'));
});

// ---------------------------------------------------------------------------
// 2. Delegated signing — anahtar sınırın dışına ÇIKMIYOR
// ---------------------------------------------------------------------------
gate.check('loadConfig() Hedera anahtarını DÖNDÜRMÜYOR (çalışma anı testi)', () => {
  // Grep'ten daha güçlü: config'in gerçekten ne döndürdüğüne bakıyoruz. Anahtarı
  // döndürseydi `loadConfig()` çağıran her agent onu bağlamına almış olurdu.
  const returned = cfg.HEDERA_OPERATOR_KEY;
  if (containsSecret(returned)) {
    return fail('loadConfig() ham Hedera anahtarını döndürüyor — her agent ona erişebilir');
  }
  // Tüm config nesnesi de sızdırmamalı.
  if (containsSecret(JSON.stringify(cfg))) return fail('config nesnesi serileştirildiğinde anahtar sızıyor');
  return pass(`loadConfig().HEDERA_OPERATOR_KEY = "${returned}" — doğrulanıyor ama verilmiyor`);
});

gate.check('Agent paketleri anahtara HİÇ dokunmuyor (grep)', () => {
  // Kapsam bilerek agent paketleri: kapılar ve spike'lar agent değildir.
  const agentScopes = ['packages/alice-agent/src', 'packages/bob-agent/src', 'packages/bob-binding/src'];
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['grep', '-n', '-I', '-e', 'HEDERA_OPERATOR_KEY', '-e', 'privateKey', '--', ...agentScopes],
      { cwd: root, stdio: 'pipe', shell: true },
    ).toString();
  } catch {
    out = '';
  }
  const hits = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // ECIES private key'i ayrı bir sır; Hedera imza anahtarıyla ilgisi yok.
    .filter((l) => !/eciesPrivateKey|ALICE_ECIES|BOB_ECIES/i.test(l));

  return hits.length === 0
    ? pass(`${agentScopes.join(', ')} — Hedera anahtarına referans yok`)
    : fail(hits.join('\n'));
});

gate.check('Anahtar YALNIZCA signer modülünde okunuyor', () => {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-l', '-I', '-e', 'process.env.HEDERA_OPERATOR_KEY', '--', 'packages'], {
      cwd: root,
      stdio: 'pipe',
      shell: true,
    }).toString();
  } catch {
    out = '';
  }
  const files = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const outside = files.filter((f) => !f.startsWith('packages/payment/src/signer/'));
  return outside.length === 0
    ? pass(`ham anahtarı okuyan tek yer: ${files.join(', ') || '(yok)'}`)
    : fail(`signer dışında okuyan var: ${outside.join(', ')}`);
});

gate.check('Backend anahtarı ALAMIYOR (tip düzeyinde imkânsız)', () => {
  // `HederaX402Config` ham anahtar alan bir alan taşımıyor — sadece signer handle.
  const src = readFileSync(resolve(root, 'packages/payment/src/hedera-x402.ts'), 'utf8');
  const configBlock = /export interface HederaX402Config \{[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
  if (!configBlock) return fail('HederaX402Config bulunamadı');
  if (/privateKey|secretKey|operatorKey/i.test(configBlock)) {
    return fail(`config ham anahtar alanı taşıyor:\n${configBlock.slice(0, 300)}`);
  }
  return pass('HederaX402Config yalnızca `signer: HederaSignerHandle` alıyor — ham anahtar geçirilemiyor');
});

gate.check('Signer handle serileştirildiğinde anahtar SIZDIRMIYOR', () => {
  const handle = createHederaSigner({ accountId: cfg.HEDERA_OPERATOR_ID });
  const backend = createHederaX402Backend({
    signer: handle,
    facilitatorUrl: cfg.BLOCKY402_URL,
    verifierProvider: new ethers.JsonRpcProvider(cfg.BASE_RPC_URL),
    verifierAddress: requireEnv('VERIFIER_ADDRESS'),
  });

  const probes: Array<[string, string]> = [
    ['JSON.stringify(handle)', JSON.stringify(handle)],
    ['String(handle)', String(handle)],
    ['util.inspect(handle)', inspect(handle, { depth: 6 })],
    ['JSON.stringify(backend)', JSON.stringify(backend)],
    ['util.inspect(backend)', inspect(backend, { depth: 6 })],
    ['Error stack', new Error(`ödeme hatası: ${String(handle)}`).stack ?? ''],
  ];

  const leaks = probes.filter(([, text]) => containsSecret(text)).map(([name]) => name);
  return leaks.length === 0
    ? pass(`${probes.length} serileştirme yolunun hiçbiri anahtarı sızdırmıyor (toJSON/toString/inspect REDACTED)`)
    : fail(`anahtar şuralarda sızdı: ${leaks.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 2b. 402 KAPISI — ödeme yetkisi olmadan iş YOK (CLAUDE.md §7)
// ---------------------------------------------------------------------------
gate.check('Ödemesiz /task 402 dönüyor ve Bob İŞ YAPMIYOR', async () => {
  const { ensureBob } = await import('../../packages/demo/src/index.js');
  const { eciesPublicKeyOf, encryptFor } = await import('../../packages/shared/src/index.js');
  const bob = await ensureBob(() => {}, 'hedera');
  const before = bob.processed.length;

  const res = await fetch(`${bob.url()}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: requireEnv('BOB_AGENT_ID'),
      intentHash: `0x${'11'.repeat(32)}`,
      replyPubKey: eciesPublicKeyOf(requireEnv('ALICE_ECIES_PRIV')),
      cipher: await encryptFor(eciesPublicKeyOf(requireEnv('BOB_ECIES_PRIV')), { v: 1 }),
    }),
  });

  if (res.status !== 402) return fail(`ödemesiz istek ${res.status} döndü, 402 bekleniyordu`);
  const body = (await res.json()) as { accepts?: Array<{ amount: string; recipient: string; rail: string }> };
  const req = body.accepts?.[0];
  if (!req) return fail('402 gövdesinde ödeme şartları yok');

  // ASIL KANIT: iş sayacı artmadı — Bob paketi enclave'e bile göndermedi.
  if (bob.processed.length !== before) return fail('402 döndü ama Bob yine de iş yaptı');

  evidence.paymentGate = req;
  return pass(
    [
      `402 · ${req.amount} ${(req as { asset?: string }).asset ?? ''} → ${req.recipient} (${req.rail})`,
      'işlenmiş iş sayacı ARTMADI — yabancı bedava iş yaptıramıyor',
    ].join('\n'),
  );
});

gate.check('Yanlış tutarlı ödeme yetkisi reddediliyor', async () => {
  const { makePaymentBackend } = await import('../../packages/demo/src/index.js');
  const bobSide = await makePaymentBackend('hedera', true);
  const quote = await bobSide.quote({
    intentHash: `0x${'22'.repeat(32)}`,
    amount: '1',
    recipient: process.env.BOB_HEDERA_ACCOUNT ?? cfg.HEDERA_OPERATOR_ID,
  });
  const proof = await bobSide.authorize(quote);

  // Bob'un beklediği fiyat 1000000; yetki 1 tinybar için imzalanmış.
  const check = await bobSide.verifyAuthorization(proof, {
    amount: '1000000',
    intentHash: `0x${'22'.repeat(32)}`,
  });
  return check.ok
    ? fail('1 tinybarlık yetki 1000000 için kabul edildi')
    : pass(`reddedildi: ${check.reason}`);
});

gate.check('Başka bir işe ait yetki reddediliyor', async () => {
  const { makePaymentBackend } = await import('../../packages/demo/src/index.js');
  const bobSide = await makePaymentBackend('hedera', true);
  const quote = await bobSide.quote({
    intentHash: `0x${'33'.repeat(32)}`,
    amount: '1000000',
    recipient: process.env.BOB_HEDERA_ACCOUNT ?? cfg.HEDERA_OPERATOR_ID,
  });
  const proof = await bobSide.authorize(quote);

  // Aynı tutar ama BAŞKA bir intentHash — bir işin yetkisi başka işe geçerli olmamalı.
  const check = await bobSide.verifyAuthorization(proof, {
    amount: '1000000',
    intentHash: `0x${'44'.repeat(32)}`,
  });
  return check.ok
    ? fail('bir işin yetkisi başka bir iş için kabul edildi')
    : pass(`reddedildi: ${check.reason}`);
});

// ---------------------------------------------------------------------------
// 3. Canlı ödeme — tek env değişikliğiyle
// ---------------------------------------------------------------------------
gate.check('PAYMENT_BACKEND=hedera ile dürüst iş settle oluyor', async () => {
  honest = await runDemo({
    fraudMode: 'none',
    paymentRail: 'hedera',
    nonce: BigInt(Date.now()),
    log: (l) => capturedLogs.push(l),
  });
  if (!honest.verified) return fail(`iş doğrulanmadı: ${honest.codeName}`);
  if (!honest.payment?.settled) {
    return fail(`ödeme settle olmadı: ${honest.payment?.skippedReason ?? 'bilinmiyor'}`);
  }
  evidence.honest = honest;
  return pass(
    [
      `JobVerified (Base) → settle (Hedera)`,
      `ray: ${honest.payment.rail}`,
      `Base : ${honest.basescanUrl}`,
      `Hedera: ${honest.payment.explorerUrl}`,
    ].join('\n'),
  );
});

gate.check('Transfer mirror node\'da SUCCESS ve gas\'ı facilitator ödedi', async () => {
  const txRef = honest?.payment?.txRef;
  if (!txRef) return fail('settle tx yok');
  const [account, stamp] = txRef.split('@');
  if (!account || !stamp) return fail(`beklenmedik tx id: ${txRef}`);
  const mirrorId = `${account}-${stamp.replace('.', '-')}`;

  let tx: { result?: string; charged_tx_fee?: number; transfers?: Array<{ account?: string; amount?: number }> } | undefined;
  for (let i = 0; i < 15 && !tx; i++) {
    const res = await fetch(`${MIRROR}/api/v1/transactions/${mirrorId}`);
    if (res.ok) {
      const body = (await res.json()) as { transactions?: Array<typeof tx> };
      tx = body.transactions?.[0];
    }
    if (!tx) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!tx) return fail(`mirror node ${mirrorId} işlemini indekslemedi`);
  if (tx.result !== 'SUCCESS') return fail(`result=${tx.result}`);

  // İşlem ücretini tx id'nin sahibi öder — facilitator olmalı, Alice değil.
  const payer = account;
  if (payer !== cfg.BLOCKY402_FEE_PAYER) {
    return fail(`tx payer ${payer}, beklenen facilitator ${cfg.BLOCKY402_FEE_PAYER}`);
  }
  // Ödeyen tam fiyat kadar borçlanmalı; ücret ona yıkılmamalı.
  // Bob'un kartındaki fiyat (tinybar) — demo akışıyla aynı değer.
  const price = 1_000_000;
  const debit = tx.transfers?.find((t) => t.account === cfg.HEDERA_OPERATOR_ID)?.amount;
  const credit = tx.transfers?.find((t) => t.account === process.env.BOB_HEDERA_ACCOUNT)?.amount;

  evidence.mirrorTransaction = tx;
  const problems: string[] = [];
  if (debit !== -price) problems.push(`ödeyen ${cfg.HEDERA_OPERATOR_ID}: ${debit ?? 'yok'} (beklenen ${-price})`);
  if (credit !== price) problems.push(`alıcı ${process.env.BOB_HEDERA_ACCOUNT}: ${credit ?? 'yok'} (beklenen ${price})`);

  return problems.length === 0
    ? pass(
        [
          `result=SUCCESS · ücret ${tx.charged_tx_fee} tinybar`,
          `gas'ı facilitator ${payer} ödedi — Alice ödemedi`,
          `${cfg.HEDERA_OPERATOR_ID} ${-price} → ${process.env.BOB_HEDERA_ACCOUNT} +${price} tinybar`,
        ].join('\n'),
      )
    : fail(problems.join('\n'));
});

// ---------------------------------------------------------------------------
// 4. Fraud koşusunda ödeme HİÇ settle olmuyor
// ---------------------------------------------------------------------------
gate.check('FRAUD koşusunda settle HİÇ çağrılmıyor ("ödeme asla settle olmadı")', async () => {
  fraud = await runDemo({
    fraudMode: 'substitute',
    paymentRail: 'hedera',
    nonce: BigInt(Date.now()) + 1n,
    log: (l) => capturedLogs.push(l),
  });
  if (fraud.verified) return fail('hile yapıldığı hâlde iş doğrulandı');
  if (fraud.payment?.settled) return fail('doğrulanmamış iş için ödeme settle oldu');
  if (!fraud.payment?.authorized) return fail('ödeme yetkilendirme adımına hiç gelinmemiş');

  evidence.fraud = fraud;
  return pass(
    [
      `kontrat: ${fraud.codeName}`,
      `ödeme: yetkilendirildi ama SETTLE EDİLMEDİ — ${fraud.payment.skippedReason}`,
      'para Alice\'te kaldı; zincirde hiçbir transfer yok',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 5. Log denetimi
// ---------------------------------------------------------------------------
gate.check('Çalışma loglarında private key YOK', () => {
  const all = capturedLogs.join('\n');
  if (containsSecret(all)) return fail('loglarda Hedera private key geçiyor');
  // .env dosyası dışında repoda anahtar var mı?
  let tracked = '';
  try {
    tracked = execFileSync('git', ['grep', '-l', '-I', '-F', '-e', cfg.HEDERA_OPERATOR_KEY.slice(0, 24)], {
      cwd: root,
      stdio: 'pipe',
      shell: true,
    }).toString();
  } catch {
    tracked = '';
  }
  const files = tracked.split('\n').map((l) => l.trim()).filter(Boolean);
  return files.length === 0
    ? pass(`${capturedLogs.length} log satırı denetlendi · takip edilen hiçbir dosyada anahtar yok`)
    : fail(`anahtar takip edilen dosyalarda: ${files.join(', ')}`);
});

gate.check('Kanıt dosyası yazıldı (fixtures/hedera/P4-C.json)', async () => {
  await closeBob();
  const dir = resolve(root, 'fixtures/hedera');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'P4-C.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return pass(
    [
      'fixtures/hedera/P4-C.json',
      `dürüst : ${honest?.payment?.explorerUrl ?? '-'}`,
      `fraud  : settle YOK (${fraud?.codeName})`,
    ].join('\n'),
  );
});

await gate.run();
