// tests/gates/P4-A.ts — PaymentBackend arayüzü kapısı.
//
// BUILD-PLAN P4-A geçiş kriteri:
//   [ ] İki backend de interface'i karşılıyor
//   [ ] Alice'in orkestrasyon kodunda HİÇBİR `if (chain === ...)` yok (grep ile kanıtla)
//
// Fazladan ve asıl önemli kriter: settlement'ın `JobVerified`'a bağlı olması bir
// KONVANSİYON değil, YAPISAL bir kapı. Bunu P3-D'nin ürettiği GERÇEK zincir
// verisiyle test ediyoruz: gerçek bir JobVerified tx'i geçiyor, gerçek bir
// JobRejected tx'i geçmiyor.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import {
  SettlementNotAuthorizedError,
  assertJobVerified,
  type PaymentBackend,
} from '../../packages/payment/src/index.js';
import { createHederaX402Backend } from '../../packages/payment/src/hedera-x402.js';
import { createBaseStealthBackend } from '../../packages/payment/src/base-stealth.js';
import { loadConfig, loadDotenv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const gate = new Gate('P4-A', 'PaymentBackend arayüzü — tek arayüz, iki ray');
const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
const verifierAddress = requireEnv('VERIFIER_ADDRESS');

/** P3-D'nin zincire yazdığı gerçek tx'ler — kanıt dosyasından okunuyor. */
type P3DEvidence = {
  honestRuns?: Array<{ txHash?: string; signedIntentHash: string; bodyIntentHash: string }>;
  fraudRuns?: Record<string, { tx?: string; name: string }>;
};
let p3d: P3DEvidence = {};
try {
  p3d = JSON.parse(readFileSync(resolve(root, 'fixtures/p3d/P3-D.json'), 'utf8')) as P3DEvidence;
} catch {
  /* kapı aşağıda anlamlı hata verecek */
}

let backends: PaymentBackend[] = [];

// ---------------------------------------------------------------------------
// 1. İki backend de arayüzü karşılıyor
// ---------------------------------------------------------------------------
gate.check('İki backend de PaymentBackend arayüzünü karşılıyor', () => {
  const hedera = createHederaX402Backend({
    accountId: cfg.HEDERA_OPERATOR_ID,
    privateKey: cfg.HEDERA_OPERATOR_KEY,
    facilitatorUrl: cfg.BLOCKY402_URL,
    verifierProvider: provider,
    verifierAddress,
  });
  const base = createBaseStealthBackend({
    provider,
    payerPrivateKey: cfg.PRIVATE_KEY_ALICE,
    usdcAddress: cfg.USDC_BASE_SEPOLIA,
    verifierAddress,
  });
  backends = [hedera, base];

  const required = ['quote', 'authorize', 'settle', 'verify'] as const;
  const problems: string[] = [];
  for (const b of backends) {
    if (!b.rail) problems.push('rail alanı yok');
    for (const m of required) {
      if (typeof (b as unknown as Record<string, unknown>)[m] !== 'function') {
        problems.push(`${b.rail}: ${m}() yok`);
      }
    }
  }
  const rails = backends.map((b) => b.rail);
  if (new Set(rails).size !== 2) problems.push(`iki farklı ray bekleniyordu: ${rails.join(', ')}`);

  return problems.length === 0
    ? pass(`${rails.join(' · ')} — dördü de (quote, authorize, settle, verify) mevcut`)
    : fail(problems.join('\n'));
});

// ---------------------------------------------------------------------------
// 2. Settlement JobVerified'a YAPISAL olarak bağlı
// ---------------------------------------------------------------------------
gate.check('jobVerifiedTx olmadan settle() reddediliyor', async () => {
  const problems: string[] = [];
  for (const b of backends) {
    try {
      await b.settle(
        { rail: b.rail, intentHash: `0x${'11'.repeat(32)}`, payTo: 'x', amount: '1', payload: {} },
        '',
      );
      problems.push(`${b.rail}: boş jobVerifiedTx ile settle() patlamadı`);
    } catch (err) {
      if (!(err instanceof SettlementNotAuthorizedError)) {
        problems.push(`${b.rail}: beklenen SettlementNotAuthorizedError değil — ${String(err).slice(0, 80)}`);
      }
    }
  }
  return problems.length === 0
    ? pass('iki backend de doğrulanmamış iş için parayı serbest bırakmıyor')
    : fail(problems.join('\n'));
});

gate.check('GERÇEK JobVerified tx\'i kapıdan geçiyor', async () => {
  const run = p3d.honestRuns?.find((r) => r.txHash);
  if (!run?.txHash) return fail('fixtures/p3d/P3-D.json içinde JobVerified tx yok — önce pnpm gate:P3-D');

  const proof = await assertJobVerified(provider, verifierAddress, run.txHash, run.signedIntentHash);
  return proof.intentHash.toLowerCase() === run.signedIntentHash.toLowerCase()
    ? pass(
        [
          `tx ${run.txHash.slice(0, 20)}… blok ${proof.blockNumber}`,
          `intentHash ${proof.intentHash.slice(0, 20)}… · agentId ${proof.agentId} · price ${proof.price}`,
        ].join('\n'),
      )
    : fail('kapı yanlış intentHash döndürdü');
});

gate.check('GERÇEK JobRejected tx\'i kapıdan GEÇMİYOR (fraud koşusu settle etmez)', async () => {
  const fraud = Object.entries(p3d.fraudRuns ?? {}).find(([, v]) => v.tx);
  if (!fraud) return fail('fixtures/p3d/P3-D.json içinde fraud tx yok — önce pnpm gate:P3-D');
  const [mode, info] = fraud;

  // Fraud koşusunda `JobVerified` HİÇ oluşmadı; o tx'i settle gerekçesi göstermek
  // demonun en güçlü cümlesinin ("ödeme asla settle olmadı") teknik karşılığı.
  try {
    await assertJobVerified(provider, verifierAddress, info.tx!, `0x${'22'.repeat(32)}`);
    return fail(`${mode} tx'i JobVerified kapısından geçti — ödeme settle edilebilirdi`);
  } catch (err) {
    if (!(err instanceof SettlementNotAuthorizedError)) {
      return fail(`beklenen SettlementNotAuthorizedError değil: ${String(err).slice(0, 100)}`);
    }
    return pass(`${mode} (${info.name}) tx'i reddedildi:\n${(err as Error).message.slice(0, 150)}`);
  }
});

gate.check('BAŞKA bir işin JobVerified\'ı bu iş için kullanılamıyor', async () => {
  const run = p3d.honestRuns?.find((r) => r.txHash);
  if (!run?.txHash) return fail('JobVerified tx yok');
  // Geçerli bir JobVerified tx'i + BAŞKA bir intentHash → reddedilmeli.
  // Aksi hâlde Bob bir kez doğrulanmış işi gösterip her ödemeyi tahsil edebilirdi.
  try {
    await assertJobVerified(provider, verifierAddress, run.txHash, `0x${'33'.repeat(32)}`);
    return fail('başka bir işin intentHash\'i geçerli sayıldı — tek doğrulama ile her ödeme tahsil edilebilirdi');
  } catch (err) {
    return err instanceof SettlementNotAuthorizedError
      ? pass('JobVerified yalnızca KENDİ intentHash\'i için geçerli')
      : fail(`beklenen hata değil: ${String(err).slice(0, 100)}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Alice'te ray dallanması YOK
// ---------------------------------------------------------------------------
gate.check('Alice\'in orkestrasyonunda ray dallanması YOK (grep)', () => {
  // Planın kriteri: "Alice'in orkestrasyon kodunda hiçbir if (chain === ...) yok".
  const patterns = [
    'chain ===',
    "=== 'hedera'",
    "=== 'base'",
    "rail ===",
    'PAYMENT_BACKEND ===',
    'hedera-x402',
    'base-stealth',
  ];
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['grep', '-n', '-I', '-F', ...patterns.flatMap((p) => ['-e', p]), '--', 'packages/alice-agent/src'],
      { cwd: root, stdio: 'pipe', shell: true },
    ).toString();
  } catch {
    out = ''; // eşleşme yoksa git grep exit 1
  }
  const hits = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return hits.length === 0
    ? pass(
        [
          `aranan: ${patterns.join(', ')}`,
          'packages/alice-agent/src içinde eşleşme yok — ödeme rayı Alice için görünmez',
        ].join('\n'),
      )
    : fail(`ray dallanması bulundu:\n${hits.slice(0, 10).join('\n')}`);
});

gate.check('Ray seçimi yalnızca yapılandırmadan geliyor', () => {
  // Backend'i kim seçiyor: bob-agent/demo tarafında tek bir yer olmalı, Alice değil.
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-l', '-I', '-e', 'createHederaX402Backend', '-e', 'createBaseStealthBackend', '--', 'packages', 'scripts'], {
      cwd: root,
      stdio: 'pipe',
      shell: true,
    }).toString();
  } catch {
    out = '';
  }
  const files = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const inAlice = files.filter((f) => f.includes('alice-agent'));
  return inAlice.length === 0
    ? pass(`backend fabrikaları yalnızca: ${files.join(', ') || '(henüz çağıran yok)'}`)
    : fail(`Alice backend fabrikasını doğrudan çağırıyor: ${inAlice.join(', ')}`);
});

await gate.run();
