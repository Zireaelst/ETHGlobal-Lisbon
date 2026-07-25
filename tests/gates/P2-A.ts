// tests/gates/P2-A.ts — Agent card + ERC-8004 kaydını üretime alma kapısı.
//
// BUILD-PLAN P2-A geçiş kriterleri:
//   [ ] Agent card CANLI URL'den çekiliyor, zod şemasından geçiyor
//   [ ] Card'daki eciesPubKey ile şifrelenen paket Bob tarafından ÇÖZÜLÜYOR
//       (kayıt ile çalışan anahtar aynı — kopyala-yapıştır hatası burada yakalanır)
//   [ ] On-chain kayıt ile card içeriği tutarlı
//
// GERÇEK Base Sepolia'ya yazar. P0-F'in kanıtladığı gibi `setMetadata` ile güncelliyoruz,
// yeniden kayıt YOK — agentId'ler sabit kalıyor (subgraph startBlock'u da öyle).

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { createBobAgent, type BobAgent } from '../../packages/bob-agent/src/index.js';
import { runAliceJob } from '../../packages/alice-agent/src/index.js';
import {
  AgentCardSchema,
  METADATA_KEYS,
  PLACEHOLDER_VERIFIER,
  eciesPublicKeyOf,
  identityRegistry,
  identityRegistryInterface,
  parseOrThrow,
  readUtf8Metadata,
  readUtf8MetadataUntil,
  type Constraints,
} from '../../packages/shared/src/index.js';
import { loadConfig, loadDotenv, optionalEnv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const BASESCAN = 'https://sepolia.basescan.org';
const gate = new Gate('P2-A', 'Agent card + ERC-8004 kaydı (üretim değerleri)');
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString() };

const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
const bobWallet = new ethers.Wallet(cfg.PRIVATE_KEY_BOB, provider);
const aliceWallet = new ethers.Wallet(cfg.PRIVATE_KEY_ALICE, provider);

const BOB_AGENT_ID = requireEnv('BOB_AGENT_ID', 'pnpm gate:P0-F doldurur');
const ALICE_AGENT_ID = requireEnv('ALICE_AGENT_ID', 'pnpm gate:P0-F doldurur');
const bobEciesPriv = requireEnv('BOB_ECIES_PRIV', 'pnpm gate:P1-B üretir');
const aliceEciesPriv = requireEnv('ALICE_ECIES_PRIV', 'pnpm gate:P1-B üretir');

const BOB_ECIES_PUB = eciesPublicKeyOf(bobEciesPriv);
const ALICE_ECIES_PUB = eciesPublicKeyOf(aliceEciesPriv);
const BOB_PORT = 8811;
const BOB_PUBLIC_URL = optionalEnv('BOB_PUBLIC_URL') ?? `http://127.0.0.1:${BOB_PORT}`;
const BOB_SKILL = 'market-analysis';

/** Zincirdeki bir metadata alanını hedef değere getir. Zaten doğruysa tx atmaz. */
async function ensureMetadata(
  wallet: ethers.Wallet,
  agentId: string,
  key: string,
  want: string,
): Promise<{ changed: boolean; tx?: string }> {
  const readRegistry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const current = await readUtf8Metadata(readRegistry, agentId, key).catch(() => undefined);
  if (current === want) return { changed: false };

  const writeRegistry = identityRegistry(cfg.ERC8004_IDENTITY, wallet);
  const tx = await writeRegistry.getFunction('setMetadata')(agentId, key, ethers.toUtf8Bytes(want));
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`setMetadata(${key}) başarısız: ${tx.hash}`);

  // Yazmanın kanıtı işlemin kendi event'i — RPC replika gecikmesinden bağımsız (P0-F dersi).
  const emitted = receipt.logs
    .map((l: { topics: readonly string[]; data: string }) =>
      identityRegistryInterface.parseLog({ topics: [...l.topics], data: l.data }),
    )
    .find((p: { name: string } | null) => p?.name === 'MetadataSet');
  if (!emitted) throw new Error(`setMetadata(${key}) MetadataSet yaymadı: ${tx.hash}`);

  const settled = await readUtf8MetadataUntil(readRegistry, agentId, key, want);
  if (settled !== want) throw new Error(`setMetadata(${key}) yazıldı ama okuma yakalayamadı (RPC gecikmesi)`);
  return { changed: true, tx: tx.hash };
}

// ---------------------------------------------------------------------------
// 1. Zincire gerçek değerleri yaz
// ---------------------------------------------------------------------------
const writes: string[] = [];

gate.check('Bob\'un on-chain metadata\'sı gerçek değerlere güncellendi', async () => {
  const targets: Array<[string, string]> = [
    [METADATA_KEYS.skill, BOB_SKILL],
    [METADATA_KEYS.endpoint, `${BOB_PUBLIC_URL}/task`],
    [METADATA_KEYS.eciesPubKey, BOB_ECIES_PUB],
  ];
  const lines: string[] = [];
  for (const [key, want] of targets) {
    const r = await ensureMetadata(bobWallet, BOB_AGENT_ID, key, want);
    lines.push(
      r.changed
        ? `↑ ${key.padEnd(12)} yazıldı  ${BASESCAN}/tx/${r.tx}`
        : `= ${key.padEnd(12)} zaten doğru`,
    );
    if (r.tx) writes.push(`${key}: ${r.tx}`);
  }
  evidence.bobMetadata = Object.fromEntries(targets);
  return pass(lines.join('\n'));
});

gate.check('Alice\'in on-chain metadata\'sı gerçek değerlere güncellendi', async () => {
  const targets: Array<[string, string]> = [
    [METADATA_KEYS.skill, 'client'],
    [METADATA_KEYS.eciesPubKey, ALICE_ECIES_PUB],
  ];
  const lines: string[] = [];
  for (const [key, want] of targets) {
    const r = await ensureMetadata(aliceWallet, ALICE_AGENT_ID, key, want);
    lines.push(r.changed ? `↑ ${key.padEnd(12)} yazıldı  ${BASESCAN}/tx/${r.tx}` : `= ${key.padEnd(12)} zaten doğru`);
    if (r.tx) writes.push(`alice/${key}: ${r.tx}`);
  }
  evidence.aliceMetadata = Object.fromEntries(targets);
  return pass(lines.join('\n'));
});

gate.check('Yer tutucu değerler zincirde KALMADI', async () => {
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const suspicious = ['placeholder', 'example.invalid', 'confidential-inference-relay'];
  const problems: string[] = [];
  for (const [who, agentId] of [
    ['Bob', BOB_AGENT_ID],
    ['Alice', ALICE_AGENT_ID],
  ] as const) {
    for (const key of [METADATA_KEYS.skill, METADATA_KEYS.endpoint, METADATA_KEYS.eciesPubKey]) {
      const v = await readUtf8Metadata(registry, agentId, key).catch(() => undefined);
      if (!v) continue;
      const hit = suspicious.find((s) => v.toLowerCase().includes(s));
      if (hit) problems.push(`${who}.${key} hâlâ yer tutucu içeriyor: "${v}"`);
    }
  }
  return problems.length === 0
    ? pass('skill / endpoint / eciesPubKey alanlarında yer tutucu kalmadı')
    : fail(problems.join('\n'));
});

// ---------------------------------------------------------------------------
// 2. Canlı agent card
// ---------------------------------------------------------------------------
let bob: BobAgent | undefined;
let card: import('../../packages/shared/src/schema.js').AgentCard | undefined;

gate.check('Agent card CANLI URL\'den çekiliyor ve şemadan geçiyor', async () => {
  bob = createBobAgent({
    eciesPrivateKey: bobEciesPriv,
    agentId: BOB_AGENT_ID,
    owner: bobWallet.address,
    skills: [BOB_SKILL],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract: optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER,
    bindingKey: ethers.keccak256(ethers.toUtf8Bytes(`phase1-binding-key/${cfg.PRIVATE_KEY_BOB}`)),
    port: BOB_PORT,
    publicUrl: BOB_PUBLIC_URL,
    log: () => {},
  });
  await bob.listen();

  // HTTP üzerinden, elde tutulan nesneden değil — jürinin yapacağı şey bu.
  const res = await fetch(`http://127.0.0.1:${BOB_PORT}/.well-known/agent-card.json`);
  if (res.status !== 200) return fail(`HTTP ${res.status}`);
  card = parseOrThrow(AgentCardSchema, await res.json(), 'AgentCard');
  evidence.card = card;

  return pass(
    [
      `${BOB_PUBLIC_URL}/.well-known/agent-card.json`,
      `agentId ${card.agentId} · skills ${card.skills.join(',')}`,
      `endpoint ${card.endpoint}`,
      `eciesPubKey ${card.eciesPubKey.slice(0, 26)}…`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 3. Kayıt ↔ card ↔ çalışan anahtar tutarlılığı
// ---------------------------------------------------------------------------
gate.check('On-chain kayıt ile card içeriği TUTARLI', async () => {
  if (!card) return fail('card yok');
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);

  const onChain = {
    skill: await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.skill),
    endpoint: await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.endpoint),
    eciesPubKey: await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.eciesPubKey),
  };
  const owner = (await registry.ownerOf(BOB_AGENT_ID)) as string;

  const problems: string[] = [];
  if (!card.skills.includes(onChain.skill ?? '')) problems.push(`skill: zincir "${onChain.skill}" ≠ card ${card.skills.join(',')}`);
  if (onChain.endpoint !== card.endpoint) problems.push(`endpoint: zincir "${onChain.endpoint}" ≠ card "${card.endpoint}"`);
  if (onChain.eciesPubKey !== card.eciesPubKey) problems.push('eciesPubKey: zincir ≠ card');
  if (owner.toLowerCase() !== card.owner.toLowerCase()) problems.push(`owner: zincir ${owner} ≠ card ${card.owner}`);
  if (card.agentId !== BOB_AGENT_ID) problems.push(`agentId: card ${card.agentId} ≠ .env ${BOB_AGENT_ID}`);

  evidence.onChain = onChain;
  return problems.length === 0
    ? pass(['skill ✓', 'endpoint ✓', 'eciesPubKey ✓', 'owner ✓', 'agentId ✓'].join(' · '))
    : fail(problems.join('\n'));
});

gate.check('ZİNCİRDEN okunan eciesPubKey ile şifrelenen paketi Bob ÇÖZÜYOR', async () => {
  if (!bob) return fail('bob yok');
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const onChainPubKey = await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.eciesPubKey);
  if (!onChainPubKey) return fail('zincirde eciesPubKey yok');

  // Card'ı DEĞİL, doğrudan zincirdeki anahtarı kullanan sahte bir card ile iş koş.
  // Kayıt ile çalışan anahtar ayrışmışsa (kopyala-yapıştır hatası) burada patlar.
  const constraints: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };
  const report = await runAliceJob({
    bobUrl: `http://127.0.0.1:${BOB_PORT}`,
    brief: 'P2-A kayıt doğrulaması: bu paket ZİNCİRDEKİ anahtarla şifrelendi.',
    data: 'kayıt ↔ çalışan anahtar tutarlılık testi',
    constraints,
    wallet: new ethers.Wallet(cfg.PRIVATE_KEY_ALICE),
    eciesPrivateKey: aliceEciesPriv,
    verifyingContract: optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER,
    nonce: 2001n,
    fetchImpl: async (input, init) => {
      // Kartı zincirdeki anahtarla değiştir — Alice'in gerçekten kullandığı anahtar bu olsun.
      const res = await fetch(input as string, init as RequestInit);
      if (String(input).endsWith('/agent-card.json')) {
        const body = (await res.json()) as Record<string, unknown>;
        return new Response(JSON.stringify({ ...body, eciesPubKey: onChainPubKey }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return res;
    },
    log: () => {},
  });

  return report.matched
    ? pass(`zincirdeki anahtar ${onChainPubKey.slice(0, 22)}… ile şifrelenen paket çözüldü, match=true`)
    : fail('zincirdeki anahtarla şifrelenen paket Bob tarafından doğru işlenemedi');
});

gate.check('Alice\'in zincirdeki eciesPubKey\'i kendi anahtarıyla eşleşiyor', async () => {
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const onChain = await readUtf8Metadata(registry, ALICE_AGENT_ID, METADATA_KEYS.eciesPubKey);
  if (onChain !== ALICE_ECIES_PUB) {
    return fail(`zincir ${onChain?.slice(0, 26)}…\n.env  ${ALICE_ECIES_PUB.slice(0, 26)}…`);
  }
  // Alice'in kaydı, Bob'un sonucu ona şifrelemesi için kullanılacak — anahtar gerçekten çalışıyor mu?
  const owner = (await registry.ownerOf(ALICE_AGENT_ID)) as string;
  if (owner.toLowerCase() !== aliceWallet.address.toLowerCase()) {
    return fail(`agentId ${ALICE_AGENT_ID} sahibi ${owner}, beklenen ${aliceWallet.address}`);
  }
  return pass(`agentId ${ALICE_AGENT_ID} · owner ✓ · eciesPubKey ✓`);
});

gate.check('Kanıt dosyası yazıldı (fixtures/erc8004/P2-A.json)', async () => {
  await bob?.close();
  evidence.writes = writes;
  evidence.bobPublicUrl = BOB_PUBLIC_URL;
  const dir = resolve(root, 'fixtures/erc8004');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'P2-A.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const note = optionalEnv('BOB_PUBLIC_URL')
    ? ''
    : '\nNOT: BOB_PUBLIC_URL boş — zincire localhost yazıldı. P5-A public URL ile güncellenmeli.';
  return pass(`fixtures/erc8004/P2-A.json · ${writes.length} tx atıldı${note}`);
});

await gate.run();
