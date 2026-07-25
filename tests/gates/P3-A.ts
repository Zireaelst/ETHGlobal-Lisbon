// tests/gates/P3-A.ts — Verifier.sol kapısı (çift imza doğrulama).
//
// BUILD-PLAN P3-A geçiş kriterleri (hepsi Foundry):
//   [ ] testHappyPath — CANLI fixture ile JobVerified
//   [ ] testRejectsWrongClientSig / testRejectsNonEnclaveSigner / testRejectsMatchFalse
//   [ ] testRejectsTamperedBody / testReplay / testExpired
//   [ ] testLenientEmitsRejected — her hata kodu için doğru `code`
//   [ ] testBothVParities — hem 27 hem 28 ile üretilmiş fixture geçiyor
//   [ ] Gas: verifyJob < 200k
//
// Fixture'ları BU KAPI üretir: seal imzaları @ca/bob-binding'in GERÇEK çıktısıdır,
// elle yazılmış değerler değil.
//
// ⚠️ DÜRÜSTLÜK: "canlı fixture" burada CANLI TAPP'ten değil, bizim binding
// kodumuzun ürettiği gerçek imzadan geliyor — Tapp hosting hâlâ blokajda (P0-C).
// Format aynı olduğu için gerçek Tapp gelince DEĞİŞEN TEK ŞEY imzalayan anahtar olacak.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AbiCoder, Wallet, keccak256, toUtf8Bytes } from 'ethers';

import { runBinding, type BindingRequest } from '../../packages/bob-binding/src/binding.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  buildIntentHash,
  recoverSealCandidates,
  sealDigest,
  signSeal,
  type Constraints,
} from '../../packages/shared/src/index.js';
import { repoRoot } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

const root = repoRoot();
const gate = new Gate('P3-A', 'Verifier.sol — çift imza doğrulama');
const fixtureDir = resolve(root, 'contracts/test/fixtures');

// Deterministik test kimlikleri — .env'deki gerçek anahtarlara dokunmuyoruz.
const ALICE_PK = keccak256(toUtf8Bytes('confidential-agents/P3-A/alice'));
const BINDING_PK = keccak256(toUtf8Bytes('confidential-agents/P3-A/binding'));
const alice = new Wallet(ALICE_PK);
const bindingWallet = new Wallet(BINDING_PK);

const CONSTRAINTS: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };
const BRIEF = 'Assess revenue-recognition risk in the attached quarterly figures.';
const DATA = 'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR; 41 contracts.';
const PRICE = 1_000_000n;
const NONCE = 77n;
const AGENT_ID = 8429n;
const SEAL_FIELDS = { agentId: 'bob-tapp', sealId: '0xseal01', timestamp: '1784900000' };

function agentIdBytes32(id: bigint): string {
  return `0x${id.toString(16).padStart(64, '0')}`;
}

let honest: Awaited<ReturnType<typeof runBinding>> | undefined;
let substituted: Awaited<ReturnType<typeof runBinding>> | undefined;

// ---------------------------------------------------------------------------
// 1. Fixture üretimi — GERÇEK binding çıktısı
// ---------------------------------------------------------------------------
gate.check('Dürüst iş için canlı binding imzası üretildi', async () => {
  const intentHash = buildIntentHash({
    brief: BRIEF,
    data: DATA,
    constraints: CONSTRAINTS,
    price: PRICE,
    nonce: NONCE,
  });
  const request: BindingRequest = {
    claimedIntentHash: intentHash,
    brief: BRIEF,
    data: DATA,
    constraints: CONSTRAINTS,
    price: PRICE,
    nonce: NONCE,
    ...SEAL_FIELDS,
  };
  honest = await runBinding(request, BINDING_PK);

  if (!honest.match) return fail('dürüst iş match=false verdi');
  const candidates = recoverSealCandidates(honest.seal, honest.bodyHex, honest.seal.r, honest.seal.s);
  const ok = candidates.some((c) => c.address.toLowerCase() === bindingWallet.address.toLowerCase());
  if (!ok) return fail('üretilen imzadan binding anahtarı kurtarılamadı');

  return pass(
    [
      `intentHash ${intentHash.slice(0, 20)}…`,
      `seal r=${honest.seal.r.slice(0, 14)}… s=${honest.seal.s.slice(0, 14)}…`,
      `imzacı ${honest.signer}`,
    ].join('\n'),
  );
});

gate.check('match=false işi için canlı imza üretildi (fraud yolu)', async () => {
  if (!honest) return fail('dürüst iş yok');
  // Bob enclave'e BAŞKA bir brief besliyor; iddia edilen hash Alice'inki kalıyor.
  substituted = await runBinding(
    {
      claimedIntentHash: honest.claimedIntentHash,
      brief: 'Write a short generic market summary. (Bob substituted this brief.)',
      data: DATA,
      constraints: CONSTRAINTS,
      price: PRICE,
      nonce: NONCE,
      ...SEAL_FIELDS,
      sealId: '0xseal02',
    },
    BINDING_PK,
  );
  if (substituted.match) return fail('substitute senaryosunda match=true çıktı');
  return pass(`match=false, gövde yine imzalandı (enclave dürüstlüğü) · outputHash ${substituted.outputHash.slice(0, 18)}…`);
});

gate.check('İki v paritesi için de örnek üretildi', () => {
  // Wrapper `v`'yi attığı için kontrat 27 ve 28'i denemek zorunda. Her iki pariteyi
  // de gerçekten üreten iki örnek bulana kadar sealId'yi değiştirerek deniyoruz.
  const samples: Array<{ seal: unknown; body: string; signer: string; v: number }> = [];
  const seen = new Set<number>();

  for (let i = 0; i < 200 && seen.size < 2; i++) {
    const fields = { ...SEAL_FIELDS, sealId: `0xparity${i}` };
    const body = AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bool', 'bytes32'],
      [honest!.claimedIntentHash, honest!.outputHash, true, honest!.ogSigHash],
    );
    const seal = signSeal(fields, body, BINDING_PK);
    const hit = recoverSealCandidates(seal, body, seal.r, seal.s).find(
      (c) => c.address.toLowerCase() === bindingWallet.address.toLowerCase(),
    );
    if (!hit || seen.has(hit.v)) continue;
    seen.add(hit.v);
    samples.push({ seal, body, signer: bindingWallet.address, v: hit.v });
  }

  if (seen.size < 2) return fail(`sadece ${[...seen].join(',')} paritesi üretilebildi`);

  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    resolve(fixtureDir, 'verifier-parities.json'),
    `${JSON.stringify({ count: samples.length, samples }, null, 2)}\n`,
    'utf8',
  );
  return pass(`v=${samples.map((s) => s.v).join(' ve ')} örnekleri yazıldı`);
});

gate.check('Fixture dosyaları yazıldı', () => {
  if (!honest || !substituted) return fail('binding çıktıları yok');

  const deadline = 1900000000n;
  const main = {
    _comment:
      'pnpm gate:P3-A üretir. seal imzası @ca/bob-binding GERÇEK çıktısıdır. ' +
      'Alice imzası testin içinde atılır (domain kontrat adresine bağlı).',
    chainId: BASE_SEPOLIA_CHAIN_ID,
    alicePrivateKey: BigInt(ALICE_PK).toString(),
    intent: {
      intentHash: honest.claimedIntentHash,
      client: alice.address,
      agentId: agentIdBytes32(AGENT_ID),
      price: PRICE.toString(),
      deadline: deadline.toString(),
    },
    outputHash: honest.outputHash,
    match: honest.match,
    ogSigHash: honest.ogSigHash,
    seal: honest.seal,
    enclaveSigner: honest.signer,
    bodyHex: honest.bodyHex,
    bodyKeccak: keccak256(honest.bodyHex),
    sealDigest: sealDigest(honest.seal, honest.bodyHex),
  };
  writeFileSync(resolve(fixtureDir, 'verifier.json'), `${JSON.stringify(main, null, 2)}\n`, 'utf8');

  const matchFalse = {
    _comment: 'Bob substitute modu — enclave match=false raporladı ve YİNE İMZALADI.',
    outputHash: substituted.outputHash,
    match: substituted.match,
    ogSigHash: substituted.ogSigHash,
    seal: substituted.seal,
    bodyHex: substituted.bodyHex,
  };
  writeFileSync(resolve(fixtureDir, 'verifier-matchfalse.json'), `${JSON.stringify(matchFalse, null, 2)}\n`, 'utf8');

  return pass('verifier.json · verifier-matchfalse.json · verifier-parities.json');
});

// ---------------------------------------------------------------------------
// 2. Foundry
// ---------------------------------------------------------------------------
let forgeOutput = '';

gate.check('forge test — Verifier tüm senaryolardan geçiyor', () => {
  try {
    forgeOutput = execFileSync('forge', ['test', '--match-contract', 'VerifierTest', '-vv'], {
      cwd: resolve(root, 'contracts'),
      stdio: 'pipe',
      shell: true,
    }).toString();
    const summary = forgeOutput
      .split('\n')
      .filter((l) => l.includes('[PASS]') || l.includes('[FAIL]') || l.includes('Suite result'))
      .join('\n');
    return pass(summary);
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    forgeOutput = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
    return fail(forgeOutput.split('\n').slice(-35).join('\n'));
  }
});

const REQUIRED_TESTS = [
  'testHappyPath',
  'testRejectsWrongClientSig',
  'testRejectsNonEnclaveSigner',
  'testRejectsMatchFalse',
  'testRejectsTamperedBody',
  'testReplay',
  'testExpired',
  'testLenientEmitsRejectedWithCode',
  'testBothVParities',
  'testGasUnder200k',
];

gate.check('Planın istediği 10 testin hepsi mevcut ve GEÇİYOR', () => {
  const missing = REQUIRED_TESTS.filter((t) => !forgeOutput.includes(`[PASS] ${t}`));
  return missing.length === 0
    ? pass(REQUIRED_TESTS.join(', '))
    : fail(`geçmeyen/eksik: ${missing.join(', ')}`);
});

gate.check('Seal formatı TS ile Solidity arasında BİREBİR', () => {
  // forge çıktısında testSealDigestMatchesTS geçtiyse iki taraf aynı digest'i üretiyor.
  return forgeOutput.includes('[PASS] testSealDigestMatchesTS')
    ? pass('keccak256("agentId|sealId|timestamp|hex(sha256(body))") — iki tarafta aynı')
    : fail('testSealDigestMatchesTS geçmedi — preimage formatı ayrışıyor');
});

gate.check('Lenient yol revert ETMİYOR (fraud tx\'i Basescan\'de başarılı görünecek)', () => {
  return forgeOutput.includes('[PASS] testLenientNeverReverts')
    ? pass('her kontrol bozukken bile tx başarılı, JobRejected yayılıyor')
    : fail('testLenientNeverReverts geçmedi');
});

gate.check('Seal anahtarı MUTABLE — demo ortasında kurtarma mümkün', () => {
  return forgeOutput.includes('[PASS] testEnclaveSignerRemainsMutable')
    ? pass('setEnclaveSigner yeniden yazılabiliyor, sonrasında iş geçiyor')
    : fail('testEnclaveSignerRemainsMutable geçmedi');
});

gate.check('DÜRÜSTLÜK: fixture kaynağı açıkça etiketli', () => {
  // Kapı, canlı Tapp fixture'ı olmadığını gizlemiyor.
  return pass(
    [
      'seal imzaları @ca/bob-binding\'in GERÇEK çıktısı — elle yazılmadı.',
      'Ama CANLI TAPP\'ten gelmiyorlar: Tapp hosting P0-C\'de blokajda.',
      'Format kaynağı CLAUDE.md §3.1(B); hex küçük harf / 0x öneksiz VARSAYIMI',
      'P0-C ile doğrulanacak. Değişirse iki yer: sealsig.ts ve Verifier._sealDigest.',
      'Gerçek Tapp geldiğinde değişen tek şey İMZALAYAN ANAHTAR olacak.',
    ].join('\n'),
  );
});

await gate.run();
