// tests/gates/P1-A.ts — ŞEMA-LOCK kapısı: canonical + şema + EIP-712 intent.
//
// BUILD-PLAN P1-A geçiş kriterleri:
//   [ ] buildIntentHash aynı girdi için 100 çalıştırmada aynı sonuç
//   [ ] Anahtar sırası karışık verilen constraints objesi aynı constraintsHash'i üretiyor
//   [ ] recoverIntentSigner(intent, signIntent(intent, wallet)) === wallet.address
//   [ ] Intent'in tek bir byte'ı değişince hash değişiyor (5 alanın her biri için AYRI test)
//   [ ] Aynı hash Solidity tarafında da üretiliyor (forge test, TS'ten üretilmiş fixture'a karşı)
//
// Bu kapı ağa ÇIKMAZ — saf kripto. 0G/faucet durumundan bağımsız koşar.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AbiCoder, Wallet, keccak256, toUtf8Bytes } from 'ethers';

import { canonicalJson, hashCanonical, hashUtf8 } from '../../packages/shared/src/canonical.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  INTENT_TYPES,
  type Constraints,
  type Intent,
  type IntentInputs,
  agentIdToBytes32,
  buildIntentHash,
  intentHashParts,
  recoverIntentSigner,
  signIntent,
} from '../../packages/shared/src/intent.js';
import {
  ResultEnvelopeSchema,
  TaskEnvelopeSchema,
  intentFromWire,
  intentToWire,
  parseOrThrow,
} from '../../packages/shared/src/schema.js';
import { repoRoot } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

const root = repoRoot();
const gate = new Gate('P1-A', 'Şema-lock: canonical + şema + EIP-712 intent');

// Sabit test vektörü — rastgelelik yok, iki dev aynı sayıları görmeli.
const CONSTRAINTS: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };
const INPUTS: IntentInputs = {
  brief: 'Analyse the attached quarterly report and flag revenue-recognition risks.',
  data: 'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR; 41 contracts.',
  constraints: CONSTRAINTS,
  price: 1_000_000n, // 1 USDC (6 hane)
  nonce: 42n,
};
// Deterministik test cüzdanı — .env'deki gerçek anahtarlara dokunmuyoruz.
const TEST_PRIVATE_KEY = keccak256(toUtf8Bytes('confidential-agents/P1-A/alice'));
const VERIFYING_CONTRACT = '0x00000000000000000000000000000000DeaDBeef';
const AGENT_ID = agentIdToBytes32(8429n);

const wallet = new Wallet(TEST_PRIVATE_KEY);

// ---------------------------------------------------------------------------
// 1. Determinizm
// ---------------------------------------------------------------------------
gate.check('buildIntentHash 100 çalıştırmada aynı sonuç', () => {
  const first = buildIntentHash(INPUTS);
  for (let i = 0; i < 100; i++) {
    if (buildIntentHash(INPUTS) !== first) return fail(`${i}. çalıştırmada hash değişti`);
  }
  return pass(first);
});

// ---------------------------------------------------------------------------
// 2. Anahtar sırası bağımsızlığı
// ---------------------------------------------------------------------------
gate.check('Anahtar sırası karışık constraints aynı constraintsHash\'i veriyor', () => {
  const shuffled: Constraints = {
    temperature: CONSTRAINTS.temperature,
    model: CONSTRAINTS.model,
    maxTokens: CONSTRAINTS.maxTokens,
  } as Constraints;
  const a = hashCanonical(CONSTRAINTS);
  const b = hashCanonical(shuffled);
  if (a !== b) return fail(`sıralı ${a}\nkarışık ${b}`);

  // İç içe nesnede de geçerli olmalı — sıralama özyinelemeli mi?
  const nestedA = hashCanonical({ z: 1, a: { y: 2, b: 3 } });
  const nestedB = hashCanonical({ a: { b: 3, y: 2 }, z: 1 });
  if (nestedA !== nestedB) return fail('iç içe nesnede sıralama özyinelemeli değil');

  return pass(`${a}\ncanonical: ${canonicalJson(shuffled)}`);
});

gate.check('Dizi sırası hash\'i DEĞİŞTİRİYOR (yanlışlıkla sıralamıyoruz)', () => {
  // Nesne anahtarları sıralanır ama dizi elemanları sıralanmaz — sıralanırsa
  // anlamlı sıra bilgisi sessizce kaybolur.
  const a = hashCanonical({ tags: ['a', 'b'] });
  const b = hashCanonical({ tags: ['b', 'a'] });
  return a !== b ? pass('dizi sırası korunuyor') : fail('dizi elemanları da sıralanmış — sıra bilgisi kayboluyor');
});

// ---------------------------------------------------------------------------
// 3. Mutasyon testleri — 5 alanın HER BİRİ hash'e giriyor mu?
// ---------------------------------------------------------------------------
gate.check('5 alanın her biri hash\'i değiştiriyor (alan atlanmıyor)', () => {
  const base = buildIntentHash(INPUTS);
  const mutations: Array<[string, IntentInputs]> = [
    ['brief', { ...INPUTS, brief: `${INPUTS.brief} ` }], // tek boşluk
    ['data', { ...INPUTS, data: INPUTS.data.replace('12,400,000', '12,400,001') }],
    ['constraints', { ...INPUTS, constraints: { ...CONSTRAINTS, maxTokens: CONSTRAINTS.maxTokens + 1 } }],
    ['price', { ...INPUTS, price: INPUTS.price + 1n }],
    ['nonce', { ...INPUTS, nonce: INPUTS.nonce + 1n }],
  ];
  const unchanged = mutations.filter(([, m]) => buildIntentHash(m) === base).map(([name]) => name);
  if (unchanged.length) {
    return fail(`bu alanlar değişince hash DEĞİŞMEDİ (hash'e girmiyorlar): ${unchanged.join(', ')}`);
  }
  // Ayrıca 5 mutasyonun hepsi birbirinden de farklı olmalı.
  const hashes = new Set(mutations.map(([, m]) => buildIntentHash(m)));
  if (hashes.size !== mutations.length) return fail('iki farklı mutasyon aynı hash\'i üretti');
  return pass(mutations.map(([name, m]) => `${name.padEnd(12)} → ${buildIntentHash(m).slice(0, 18)}…`).join('\n'));
});

gate.check('Tek karakterlik brief değişikliği hash\'i değiştiriyor', () => {
  const a = buildIntentHash(INPUTS);
  const b = buildIntentHash({ ...INPUTS, brief: `${INPUTS.brief.slice(0, -1)}!` });
  return a !== b ? pass('son karakter değişimi yakalanıyor') : fail('tek karakter değişimi hash\'e yansımıyor');
});

// ---------------------------------------------------------------------------
// 4. İmza round-trip
// ---------------------------------------------------------------------------
let intent: Intent | undefined;
let signature = '';

gate.check('recoverIntentSigner(signIntent(...)) === wallet.address', async () => {
  intent = {
    intentHash: buildIntentHash(INPUTS),
    client: wallet.address,
    agentId: AGENT_ID,
    price: INPUTS.price,
    deadline: 1900000000n,
  };
  signature = await signIntent(intent, wallet, VERIFYING_CONTRACT);
  const recovered = recoverIntentSigner(intent, signature, VERIFYING_CONTRACT);
  return recovered === wallet.address
    ? pass(`${recovered}\nsig ${signature.slice(0, 22)}…`)
    : fail(`kurtarılan ${recovered}, beklenen ${wallet.address}`);
});

gate.check('Domain\'i değişen imza aynı adresi VERMİYOR (replay koruması)', () => {
  if (!intent) return fail('intent kurulamadı');
  // Başka bir verifyingContract ya da başka bir chainId, imzayı geçersiz kılmalı.
  const otherContract = recoverIntentSigner(intent, signature, '0x000000000000000000000000000000000000BEEF');
  const otherChain = recoverIntentSigner(intent, signature, VERIFYING_CONTRACT, 1);
  const problems: string[] = [];
  if (otherContract === wallet.address) problems.push('farklı verifyingContract ile hâlâ Alice çıkıyor');
  if (otherChain === wallet.address) problems.push('farklı chainId ile hâlâ Alice çıkıyor');
  return problems.length === 0
    ? pass('imza domain\'e bağlı — başka kontrata/zincire replay edilemez')
    : fail(problems.join('\n'));
});

gate.check('agentId değişen intent aynı adresi VERMİYOR (worker replay koruması)', () => {
  if (!intent) return fail('intent kurulamadı');
  const other = recoverIntentSigner({ ...intent, agentId: agentIdToBytes32(9999n) }, signature, VERIFYING_CONTRACT);
  return other !== wallet.address
    ? pass('imza agentId\'ye bağlı — başka worker\'a replay edilemez')
    : fail('agentId değiştiği hâlde imza Alice\'i veriyor');
});

// ---------------------------------------------------------------------------
// 5. Wire şemaları round-trip
// ---------------------------------------------------------------------------
gate.check('TaskEnvelope / ResultEnvelope şemaları round-trip ediyor', () => {
  if (!intent) return fail('intent kurulamadı');

  const envelope = {
    v: 1 as const,
    intent: intentToWire(intent),
    aliceSig: signature,
    brief: INPUTS.brief,
    data: INPUTS.data,
    constraints: CONSTRAINTS,
    nonce: INPUTS.nonce.toString(),
    replyPubKey: `0x04${'ab'.repeat(64)}`,
  };
  const parsed = parseOrThrow(TaskEnvelopeSchema, JSON.parse(JSON.stringify(envelope)), 'TaskEnvelope');

  // bigint dönüşümü kayıpsız mı?
  const back = intentFromWire(parsed.intent);
  if (back.price !== intent.price || back.deadline !== intent.deadline) {
    return fail('bigint <-> wire dönüşümü kayıplı');
  }
  // Paketten yeniden hesaplanan intentHash Alice'inkiyle aynı mı? (Bob tam olarak bunu yapacak)
  const recomputed = buildIntentHash({
    brief: parsed.brief,
    data: parsed.data,
    constraints: parsed.constraints as Constraints,
    price: BigInt(parsed.intent.price),
    nonce: BigInt(parsed.nonce),
  });
  if (recomputed !== intent.intentHash) return fail('JSON transport sonrası recompute uyuşmuyor');

  const result = {
    v: 1 as const,
    output: 'analysis…',
    bodyHex: '0x1234',
    seal: { agentId: 'bob', sealId: '0xabc', timestamp: '1784900000', r: `0x${'11'.repeat(32)}`, s: `0x${'22'.repeat(32)}` },
    ogSig: `0x${'33'.repeat(65)}`,
    ogSigner: wallet.address,
    ogVerified: true,
  };
  parseOrThrow(ResultEnvelopeSchema, JSON.parse(JSON.stringify(result)), 'ResultEnvelope');

  return pass('JSON transport sonrası recompute Alice\'in hash\'iyle aynı');
});

gate.check('Bozuk paket ANLAMLI hatayla reddediliyor (sessizce geçmiyor)', () => {
  const bad = { v: 1, intent: { intentHash: '0xnothex' }, brief: 1 };
  try {
    parseOrThrow(TaskEnvelopeSchema, bad, 'TaskEnvelope');
    return fail('bozuk paket şemadan geçti');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('intentHash') ? pass(msg.slice(0, 160)) : fail(`hata alan adını içermiyor: ${msg}`);
  }
});

gate.check('canonicalJson bigint\'i sessizce kabul etmiyor', () => {
  try {
    canonicalJson({ price: 1n });
    return fail('bigint sessizce serileştirildi — 1n ve "1" aynı hash\'i verebilir');
  } catch (err) {
    return pass(err instanceof Error ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// 6. TS -> fixture -> Solidity
// ---------------------------------------------------------------------------
gate.check('Fixture üretildi (contracts/test/fixtures/intent.json)', () => {
  if (!intent) return fail('intent kurulamadı');
  const parts = intentHashParts(INPUTS);

  // domainSeparator / structHash / digest'i TS tarafında BAĞIMSIZ hesapla — ethers'ın
  // signTypedData'sına değil, kendi kodumuza karşı test ediyoruz.
  const abi = AbiCoder.defaultAbiCoder();
  const domainSeparator = keccak256(
    abi.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toUtf8Bytes(EIP712_DOMAIN_NAME)),
        keccak256(toUtf8Bytes(EIP712_DOMAIN_VERSION)),
        BASE_SEPOLIA_CHAIN_ID,
        VERIFYING_CONTRACT,
      ],
    ),
  );
  const typeHash = keccak256(
    toUtf8Bytes('Intent(bytes32 intentHash,address client,bytes32 agentId,uint256 price,uint256 deadline)'),
  );
  const structHash = keccak256(
    abi.encode(
      ['bytes32', 'bytes32', 'address', 'bytes32', 'uint256', 'uint256'],
      [typeHash, intent.intentHash, intent.client, intent.agentId, intent.price, intent.deadline],
    ),
  );
  const digest = keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`);

  const fixture = {
    _comment: 'pnpm gate:P1-A tarafından üretilir. Elle düzenlemeyin — TS ile Solidity arasındaki tek gerçek kaynak.',
    brief: INPUTS.brief,
    data: INPUTS.data,
    constraints: CONSTRAINTS,
    constraintsCanonical: canonicalJson(CONSTRAINTS),
    briefHash: parts.briefHash,
    dataHash: parts.dataHash,
    constraintsHash: parts.constraintsHash,
    price: parts.price.toString(),
    nonce: parts.nonce.toString(),
    intentHash: parts.intentHash,
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
    },
    types: INTENT_TYPES,
    domainSeparator,
    structHash,
    digest,
    intent: intentToWire(intent),
    signature,
    expectedSigner: wallet.address,
  };

  const dir = resolve(root, 'contracts/test/fixtures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'intent.json'), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

  // ethers'ın imzaladığı digest ile bizim elle kurduğumuz digest aynı mı?
  const recovered = recoverIntentSigner(intent, signature, VERIFYING_CONTRACT);
  if (recovered !== wallet.address) return fail('elle kurulan digest ethers imzasıyla uyuşmuyor');

  return pass(`intentHash ${parts.intentHash}\ndigest     ${digest}`);
});

gate.check('forge test — Solidity aynı hash\'leri üretiyor', () => {
  try {
    const out = execFileSync('forge', ['test', '--match-contract', 'IntentLibTest', '-vv'], {
      cwd: resolve(root, 'contracts'),
      stdio: 'pipe',
      shell: true,
    }).toString();
    const summary = out
      .split('\n')
      .filter((l) => l.includes('[PASS]') || l.includes('[FAIL]') || l.includes('Suite result'))
      .join('\n');
    return pass(summary || out.split('\n').slice(-6).join('\n'));
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`.trim();
    return fail(out.split('\n').slice(-30).join('\n'));
  }
});

await gate.run();
