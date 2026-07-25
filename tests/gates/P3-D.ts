// tests/gates/P3-D.ts — PROJENİN ANA KAPISI.
//
// BUILD-PLAN P3-D geçiş kriterleri:
//   [ ] Tek komut (`pnpm demo:base`) baştan sona çalışıyor
//   [ ] `JobVerified` event'i Basescan'de görünüyor
//   [ ] Alice çıktıyı çözüyor ve okuyor
//   [ ] Toplam süre < 60 sn
//   [ ] FRAUD_MODE=substitute → JobRejected (MatchFalse) on-chain
//   [ ] FRAUD_MODE=forge     → JobRejected (BadEnclaveSig)
//   [ ] FRAUD_MODE=selfintent→ JobRejected (BadClientSig)
//   [ ] 3 ardışık dürüst çalıştırma, 3'ü de başarılı (tek seferlik şans değil)
//
// ⛔ Plan: "Geçmezse BURADA DURULUR. P4 ve P5 bu kapı yeşil olmadan başlamaz."
//
// GERÇEK Base Sepolia'ya yazar: her koşu bir tx.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ethers } from 'ethers';

import { closeBob, runDemo, type DemoReport } from '../../packages/demo/src/index.js';
import { loadConfig, loadDotenv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const LATENCY_BUDGET_MS = 60_000;
const gate = new Gate('P3-D', 'ANA KAPI — uçtan uca hero akışı + canlı fraud reddi');
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString() };

const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
const verifierAddress = requireEnv('VERIFIER_ADDRESS');

/** Her koşu benzersiz bir intentHash üretmeli, yoksa kontrat AlreadyVerified verir. */
let nonceSeed = BigInt(Date.now());
const nextNonce = () => nonceSeed++;

const honestRuns: DemoReport[] = [];
const fraudRuns = new Map<string, DemoReport>();

// ---------------------------------------------------------------------------
// 1. Dürüst yol — üç ardışık koşu
// ---------------------------------------------------------------------------
gate.check('3 ardışık dürüst koşu, üçü de JobVerified (tek seferlik şans değil)', async () => {
  const lines: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await runDemo({ fraudMode: 'none', nonce: nextNonce(), log: () => {} });
    honestRuns.push(r);
    lines.push(
      `${r.verified ? '✓' : '✗'} koşu ${i}: ${r.codeName} · ${r.totalMs} ms · blok ${r.blockNumber ?? '-'}`,
    );
    if (!r.verified) return fail(`${lines.join('\n')}\n→ ${i}. koşu ${r.codeName} ile reddedildi`);
  }
  evidence.honestRuns = honestRuns;
  return pass(lines.join('\n'));
});

gate.check('JobVerified event\'i zincirde GERÇEKTEN var (receipt\'ten okundu)', async () => {
  const first = honestRuns[0];
  if (!first?.txHash) return fail('tx hash yok');

  const receipt = await provider.getTransactionReceipt(first.txHash);
  if (!receipt) return fail(`${first.txHash} receipt'i alınamadı`);
  if (receipt.status !== 1) return fail(`tx status=${receipt.status}`);

  // Event'i log'lardan çöz — "tx başarılı" demek event yayıldı demek değil.
  const iface = new ethers.Interface([
    'event JobVerified(bytes32 indexed intentHash, bytes32 outputHash, address indexed client, uint256 indexed agentId, uint256 price)',
  ]);
  const found = receipt.logs
    .filter((l) => l.address.toLowerCase() === verifierAddress.toLowerCase())
    .map((l) => {
      try {
        return iface.parseLog({ topics: [...l.topics], data: l.data });
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === 'JobVerified');

  if (!found) return fail('receipt\'te JobVerified event\'i yok');
  const emittedIntent = found.args.intentHash as string;
  if (emittedIntent !== first.signedIntentHash) {
    return fail(`event intentHash ${emittedIntent} ≠ Alice'in imzaladığı ${first.signedIntentHash}`);
  }

  evidence.jobVerifiedEvent = {
    intentHash: emittedIntent,
    agentId: (found.args.agentId as bigint).toString(),
    price: (found.args.price as bigint).toString(),
    tx: first.txHash,
  };
  return pass(
    [
      `JobVerified · agentId ${(found.args.agentId as bigint).toString()} · price ${(found.args.price as bigint).toString()}`,
      `intentHash Alice'in imzaladığıyla aynı`,
      first.basescanUrl ?? '',
    ].join('\n'),
  );
});

gate.check('Alice çıktıyı çözüyor ve okuyor', () => {
  const first = honestRuns[0];
  if (!first) return fail('koşu yok');
  if (!first.output || first.output.length < 20) return fail('çıktı boş ya da anlamsız kısa');
  if (first.bodyIntentHash !== first.signedIntentHash) {
    return fail('enclave gövdesindeki taahhüt Alice\'in imzaladığından farklı');
  }
  return pass(
    [
      `${first.output.length} karakter çözüldü`,
      `compute: ${first.computeProvider} · ogVerified=${first.ogVerified}`,
      first.computeProvider === 'none'
        ? 'NOT: 0G bağlı değil — çıktı gerçek analiz DEĞİL, sistem bunu dürüstçe raporluyor'
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
});

gate.check(`Uçtan uca süre < ${LATENCY_BUDGET_MS / 1000} sn`, () => {
  if (!honestRuns.length) return fail('koşu yok');
  const times = honestRuns.map((r) => r.totalMs);
  const worst = Math.max(...times);
  const detail = `koşular: ${times.join(', ')} ms · en kötü ${worst} ms (bütçe ${LATENCY_BUDGET_MS} ms)`;
  return worst < LATENCY_BUDGET_MS
    ? pass(`${detail}\nNOT: 0G çağrısı henüz yok; gerçek çıkarım bu bütçeye eklenecek (P0-G)`)
    : fail(detail);
});

// ---------------------------------------------------------------------------
// 2. Fraud yolları — ON-CHAIN ret
// ---------------------------------------------------------------------------
const FRAUD_EXPECTATIONS: Array<[string, string, number]> = [
  ['substitute', 'MatchFalse', 5],
  ['forge', 'BadEnclaveSig', 4],
  ['selfintent', 'BadClientSig', 3],
];

for (const [mode, expectedName, expectedCode] of FRAUD_EXPECTATIONS) {
  gate.check(`FRAUD_MODE=${mode} → on-chain JobRejected(${expectedName})`, async () => {
    const r = await runDemo({ fraudMode: mode as never, nonce: nextNonce(), log: () => {} });
    fraudRuns.set(mode, r);

    if (r.verified) return fail(`hile yapıldığı hâlde JobVerified çıktı`);
    if (r.code !== expectedCode) {
      return fail(`kod ${r.code} (${r.codeName}), beklenen ${expectedCode} (${expectedName})`);
    }

    // Lenient yol REVERT ETMEMELİ — tx Basescan'de başarılı görünmeli ki
    // subgraph indeksleyebilsin ve jüriye gösterilebilsin.
    const receipt = r.txHash ? await provider.getTransactionReceipt(r.txHash) : null;
    if (!receipt) return fail('ret tx\'inin receipt\'i alınamadı');
    if (receipt.status !== 1) return fail(`ret tx\'i revert etti (status=${receipt.status}) — lenient yol kullanılmamış`);

    return pass(
      [
        `${r.codeName} · tx status=1 (revert YOK)`,
        `match=${r.match} clientSig=${r.clientSigOk} bindingSig=${r.bindingSigOk}`,
        r.basescanUrl ?? '',
      ].join('\n'),
    );
  });
}

gate.check('Üç fraud modu ÜÇ FARKLI ret kodu üretiyor', () => {
  const codes = [...fraudRuns.values()].map((r) => r.code);
  const unique = new Set(codes);
  evidence.fraudRuns = Object.fromEntries([...fraudRuns].map(([k, v]) => [k, { code: v.code, name: v.codeName, tx: v.txHash }]));
  return unique.size === 3
    ? pass([...fraudRuns].map(([m, r]) => `${m.padEnd(11)} → ${r.codeName} (${r.code})`).join('\n'))
    : fail(`${unique.size} farklı kod: ${codes.join(', ')}`);
});

gate.check('Hile yapılınca enclave YALAN SÖYLEMİYOR, kontrat reddediyor', () => {
  const sub = fraudRuns.get('substitute');
  if (!sub) return fail('substitute koşusu yok');
  // Enclave dürüstçe match=false raporladı ve gövdeyi YİNE imzaladı; imza geçerli.
  if (sub.match) return fail('substitute modunda match=true');
  if (!sub.bindingSigOk) return fail('substitute modunda enclave imzası da bozulmuş — izolasyon yok');
  return pass(
    [
      'enclave: match=false raporladı ve gövdeyi yine imzaladı (imza geçerli)',
      'kontrat: MatchFalse ile reddetti',
      '→ TEE\'nin çalıştığını değil, DOĞRU işin çalıştığını doğruluyoruz',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 3. Tek komut
// ---------------------------------------------------------------------------
gate.check('`pnpm demo:base` tek komut olarak çalışıyor', async () => {
  // Alt süreç Bob'u ZİNCİRDE kayıtlı portta (8811) açacak; kapının kendi Bob'u
  // orayı tutuyorsa EADDRINUSE alır. Önce bırakıyoruz.
  await closeBob();
  try {
    const out = execFileSync('pnpm', ['demo:base'], {
      cwd: root,
      stdio: 'pipe',
      shell: true,
      timeout: 120_000,
    }).toString();
    const ok = out.includes('JobVerified') && out.includes('karar        : OK');
    return ok
      ? pass(
          out
            .split('\n')
            .filter((l) => l.includes('verdict') || l.includes('elapsed') || l.includes('tx  '))
            .join('\n'),
        )
      : fail(out.split('\n').slice(-20).join('\n'));
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return fail(`${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`.split('\n').slice(-20).join('\n'));
  }
});

gate.check('Kanıt dosyası yazıldı (fixtures/p3d/P3-D.json)', async () => {
  await closeBob(); // idempotent — yukarıdaki kontrol zaten kapatmış olabilir
  evidence.verifier = verifierAddress;
  const dir = resolve(root, 'fixtures/p3d');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'P3-D.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const links = [
    ...honestRuns.map((r) => `  VERIFIED  ${r.basescanUrl}`),
    ...[...fraudRuns.values()].map((r) => `  ${r.codeName.padEnd(9)} ${r.basescanUrl}`),
  ];
  return pass(['fixtures/p3d/P3-D.json', ...links].join('\n'));
});

await gate.run();
