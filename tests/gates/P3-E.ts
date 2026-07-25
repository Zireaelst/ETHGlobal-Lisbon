// tests/gates/P3-E.ts — 0G Storage, encrypted archive (BUILD-PLAN P3-E, BONUS).
//
// BUILD-PLAN pass criterion, verbatim:
//   "root hash ile indirilen blob, AES anahtarıyla çözülüyor ve keccak256'sı on-chain
//    outputHash ile eşleşiyor."
//
// That single sentence is three separate claims, and this gate splits them:
//   1. FETCHABLE  — the blob comes back from the network by root hash alone. Not from Bob, not
//                   from a cache in this process: from storage nodes that have never seen us.
//   2. READABLE   — it decrypts with the key Alice received, and ONLY with that key.
//   3. THE SAME   — its keccak256 is the `outputHash` inside the sealed body, i.e. the number
//                   the contract verifies. An archive that holds a DIFFERENT deliverable than
//                   the one the chain ruled on would be worse than no archive at all.
//
// It also guards the boundary the feature could easily have broken: the AES key must reach
// Alice and NOBODY else. Bob's outer layer publishes an address it cannot read.
//
// SPENDS FAUCET CREDIT: one upload (~0.0012 OG for a small blob) plus gas. Requires OG_STORAGE=1;
// without it the gate says so and exits rather than pretending to have tested anything.

import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

import { createBobAgent, type BobAgent } from '../../packages/bob-agent/src/index.js';
import { runAliceJob } from '../../packages/alice-agent/src/index.js';
import { decodeBody } from '../../packages/bob-binding/src/binding.js';
import {
  PLACEHOLDER_VERIFIER,
  createEciesIdentity,
  newBlobKey,
  selectStorageBackend,
  type Constraints,
  type StorageBackend,
} from '../../packages/shared/src/index.js';
import { loadDotenv, optionalEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();

const gate = new Gate('P3-E', 'BONUS — 0G Storage şifreli arşiv');

const VERIFYING_CONTRACT = optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER;
const BOB_AGENT_ID = optionalEnv('BOB_AGENT_ID') ?? '8429';
const CONSTRAINTS: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };

// Recognisable content, so "the archive holds the right job" is a statement about THIS text.
const BRIEF = 'P3-E ARCHIVE PROBE: summarise the revenue-recognition risk in the attached figures.';
const DATA = 'P3-E ARCHIVE DATA: Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR; 41 contracts.';

const aliceEcies = optionalEnv('ALICE_ECIES_PRIV') ?? createEciesIdentity().privateKey;
const bobEcies = optionalEnv('BOB_ECIES_PRIV') ?? createEciesIdentity().privateKey;
const aliceWallet = Wallet.createRandom();
const bobWallet = Wallet.createRandom();
const BINDING_KEY = keccak256(toUtf8Bytes('confidential-agents/P3-E/binding'));

let storage: StorageBackend | null = null;
let bob: BobAgent | undefined;
/** Alice's decrypted view — this is the only place the AES key legitimately appears. */
let archive: { rootHash: string; txHash: string; keyHex: string; bytes: number } | undefined;
let sealedOutputHash = '';
let deliverable = '';
let downloaded = '';

// ---------------------------------------------------------------------------
gate.check('OG_STORAGE açık ve 0G Storage arka ucu kuruluyor', () => {
  storage = selectStorageBackend(process.env);
  if (!storage) {
    return fail(
      [
        'OG_STORAGE=1 değil (ya da OG_RPC_URL/OG_PRIVATE_KEY eksik).',
        'Bu kapı GERÇEK yükleme yapar; kapalıyken geçmiş gibi davranmaz.',
        'Çalıştırmak için: OG_STORAGE=1 pnpm gate:P3-E',
      ].join('\n'),
    );
  }
  return pass(`arka uç: ${storage.provider}`);
});

// ---------------------------------------------------------------------------
gate.check('Şifreleme katmanı: yanlış anahtar çöp değil HATA veriyor', async () => {
  const { encryptBlob, decryptBlob } = await import('../../packages/shared/src/storage.js');
  const key = newBlobKey();
  const blob = encryptBlob(DATA, key);

  if (blob.toString('utf8').includes(DATA.slice(0, 24))) {
    return fail('şifreli blob düz metni içeriyor');
  }
  if (decryptBlob(blob, key) !== DATA) return fail('kendi anahtarıyla çözüm dönmedi');

  const wrong = newBlobKey();
  try {
    decryptBlob(blob, wrong);
    return fail('YANLIŞ anahtar çözdü — GCM etiketi korumuyor');
  } catch {
    /* beklenen */
  }

  // A single flipped byte in the ciphertext must fail the tag too, not decode to noise.
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 0x01;
  try {
    decryptBlob(tampered, key);
    return fail('KURCALANMIŞ blob çözüldü — bütünlük yok');
  } catch {
    /* beklenen */
  }

  return pass(
    [
      `AES-256-GCM · ${blob.length} bayt (iv‖tag‖ciphertext)`,
      'yanlış anahtar → hata · kurcalanmış blob → hata (çöp veri DEĞİL)',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
gate.check('İş koşuyor ve enclave teslimatı 0G Storage\'a arşivliyor', async () => {
  if (!storage) return fail('storage arka ucu yok');
  bob = createBobAgent({
    eciesPrivateKey: bobEcies,
    agentId: BOB_AGENT_ID,
    owner: bobWallet.address,
    skills: ['market-analysis'],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract: VERIFYING_CONTRACT,
    bindingKey: BINDING_KEY,
    storage,
    log: () => {},
  });
  await bob.listen();

  const report = await runAliceJob({
    bobUrl: bob.url(),
    brief: BRIEF,
    data: DATA,
    constraints: CONSTRAINTS,
    wallet: aliceWallet,
    eciesPrivateKey: aliceEcies,
    verifyingContract: VERIFYING_CONTRACT,
    nonce: BigInt(Date.now()),
    log: () => {},
  });

  archive = report.result.storage;
  deliverable = report.result.output;
  sealedOutputHash = decodeBody(report.result.bodyHex).outputHash;

  if (!archive) return fail('sonuçta storage alanı yok — arşiv oluşmadı');
  if (!/^0x[0-9a-fA-F]{64}$/.test(archive.rootHash)) return fail(`root hash biçimsiz: ${archive.rootHash}`);

  return pass(
    [
      `root   ${archive.rootHash}`,
      `tx     ${archive.txHash}`,
      `boyut  ${archive.bytes} bayt (şifreli)`,
      `teslimat ${deliverable.length} karakter · sealed outputHash ${sealedOutputHash.slice(0, 18)}…`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
gate.check('Blob YALNIZCA root hash ile ağdan indiriliyor', async () => {
  if (!storage || !archive) return fail('arşiv yok');
  // A FRESH backend: nothing from the upload path is reused, so a cache in the previous client
  // cannot be what answers. The only input is the root hash.
  const reader = selectStorageBackend(process.env);
  if (!reader) return fail('okuyucu arka uç kurulamadı');

  const started = Date.now();
  downloaded = await reader.get(archive.rootHash, archive.keyHex);
  const ms = Date.now() - started;

  if (downloaded.length === 0) return fail('indirilen blob boş');
  return pass([`${ms} ms · ${downloaded.length} karakter geri geldi`, `root ${archive.rootHash}`].join('\n'));
});

// ---------------------------------------------------------------------------
gate.check('İndirilen blob teslimatın AYNISI ve keccak256\'sı sealed outputHash', () => {
  if (!archive) return fail('arşiv yok');
  if (downloaded !== deliverable) {
    return fail(`indirilen metin teslimattan farklı (${downloaded.length} vs ${deliverable.length} karakter)`);
  }
  const hash = keccak256(toUtf8Bytes(downloaded));
  if (hash !== sealedOutputHash) {
    return fail(`keccak256 eşleşmiyor:\n  indirilen ${hash}\n  mühürlü   ${sealedOutputHash}`);
  }
  return pass(
    [
      `keccak256(indirilen) === mühürlü outputHash`,
      hash,
      'zincirin hüküm verdiği çıktı ile arşivdeki çıktı AYNI şey',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
gate.check('Yanlış anahtarla indirme çözülemiyor (blob public, içerik değil)', async () => {
  if (!archive) return fail('arşiv yok');
  const reader = selectStorageBackend(process.env);
  if (!reader) return fail('okuyucu arka uç kurulamadı');
  try {
    await reader.get(archive.rootHash, newBlobKey());
    return fail('YABANCI bir anahtar arşivi çözdü');
  } catch {
    return pass('blob herkese açık, içeriği değil — yabancı anahtar hata alıyor');
  }
});

// ---------------------------------------------------------------------------
gate.check('AES anahtarı Bob\'un DIŞ katmanına sızmıyor', () => {
  if (!bob || !archive) return fail('koşu yok');
  const summary = bob.processed.at(-1);
  if (!summary) return fail('Bob hiçbir iş işlemedi');

  // Everything the outer layer kept about this job, as one string.
  const outerLayer = JSON.stringify(summary);
  const bare = archive.keyHex.replace(/^0x/, '');
  if (outerLayer.includes(archive.keyHex) || outerLayer.includes(bare)) {
    return fail('AES anahtarı Bob\'un iş özetinde GÖRÜNÜYOR');
  }
  // The deliverable must not be there either — the archive did not create a new leak path.
  if (outerLayer.includes(deliverable.slice(0, 32))) {
    return fail('teslimat metni Bob\'un iş özetinde görünüyor');
  }
  return pass(
    [
      'anahtar dış katmanda YOK · teslimat dış katmanda YOK',
      'Bob okuyamadığı bir blob\'un adresini yayınlıyor',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
gate.check('Sunucu kapatıldı', async () => {
  await bob?.close();
  return pass('bob kapandı');
});

await gate.run();
