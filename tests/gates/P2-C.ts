// tests/gates/P2-C.ts — Keşif entegrasyonu kapısı.
//
// BUILD-PLAN P2-C geçiş kriterleri:
//   [ ] Alice'i .env'de Bob adresi OLMADAN çalıştır → yine de çalışıyor
//       (tam olarak bu, The Graph'ın load-bearing olduğunun kanıtı)
//   [ ] İkinci bir sahte agent kaydet → arama İKİ sonuç döner → sıralama
//       `verifiedDeliveries`'e göre
//
// İkinci agent'ı Base Sepolia'ya GERÇEKTEN kaydeder (deployer cüzdanıyla, bir kez).

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import {
  METADATA_KEYS,
  PLACEHOLDER_VERIFIER,
  createEciesIdentity,
  discoverBySkill,
  eciesPublicKeyOf,
  identityRegistry,
  identityRegistryInterface,
  readUtf8Metadata,
  readUtf8MetadataUntil,
  subgraphMeta,
  utf8Metadata,
  type Constraints,
  type DiscoveredAgent,
} from '../../packages/shared/src/index.js';
import { createBobAgent, type BobAgent } from '../../packages/bob-agent/src/index.js';
import { runAliceJob } from '../../packages/alice-agent/src/index.js';
import { loadConfig, loadDotenv, optionalEnv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';
import { setEnvValue } from './_env-write.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const gate = new Gate('P2-C', 'Keşif entegrasyonu — Alice Bob\'u The Graph\'ten bulur');
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString() };

const SUBGRAPH_URL = requireEnv('SUBGRAPH_QUERY_URL');
const BOB_AGENT_ID = requireEnv('BOB_AGENT_ID');
const SKILL = 'market-analysis';
const BASESCAN = 'https://sepolia.basescan.org';

const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
const decoyWallet = new ethers.Wallet(cfg.PRIVATE_KEY_DEPLOYER, provider);

let bob: BobAgent | undefined;
/** Bob'un zincirde kayıtlı endpoint'inin portu — keşif oraya yönlendirecek. */
let bobPort = 0;

// ---------------------------------------------------------------------------
// 1. Bob'u ZİNCİRDEKİ endpoint'inde ayağa kaldır
// ---------------------------------------------------------------------------
gate.check('Bob, zincirde kayıtlı endpoint\'inde dinliyor', async () => {
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const endpoint = await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.endpoint);
  if (!endpoint) return fail('zincirde endpoint yok — önce pnpm gate:P2-A');

  const parsed = new URL(endpoint);
  bobPort = Number(parsed.port || 80);

  bob = createBobAgent({
    eciesPrivateKey: requireEnv('BOB_ECIES_PRIV'),
    agentId: BOB_AGENT_ID,
    owner: new ethers.Wallet(cfg.PRIVATE_KEY_BOB).address,
    skills: [SKILL],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract: optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER,
    bindingKey: ethers.keccak256(ethers.toUtf8Bytes(`phase1-binding-key/${cfg.PRIVATE_KEY_BOB}`)),
    port: bobPort,
    publicUrl: `${parsed.protocol}//${parsed.host}`,
    log: () => {},
  });
  await bob.listen();
  return pass(`zincirdeki endpoint ${endpoint} · Bob :${bobPort} üzerinde`);
});

// ---------------------------------------------------------------------------
// 2. ANA KRİTER: Alice Bob'un adresini BİLMEDEN çalışıyor
// ---------------------------------------------------------------------------
gate.check('Alice, Bob\'un adresi OLMADAN iş tamamlıyor (yalnızca skill ile)', async () => {
  const constraints: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };

  // DİKKAT: `bobUrl` verilmiyor. Alice'in elinde sadece subgraph adresi ve bir skill var.
  const report = await runAliceJob({
    discover: { subgraphUrl: SUBGRAPH_URL, skill: SKILL },
    brief: 'P2-C: bu iş, Bob\'un adresi hiçbir yerde verilmeden yalnızca skill araması ile yürüdü.',
    data: 'keşif → endpoint → şifreli iş → doğrulanmış sonuç',
    constraints,
    wallet: new ethers.Wallet(cfg.PRIVATE_KEY_ALICE),
    eciesPrivateKey: requireEnv('ALICE_ECIES_PRIV'),
    verifyingContract: optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER,
    nonce: 4001n,
    log: () => {},
  });

  if (!report.discovered) return fail('keşif yolu kullanılmadı');
  if (report.discovered.agentId !== BOB_AGENT_ID) {
    return fail(`keşif ${report.discovered.agentId} buldu, beklenen ${BOB_AGENT_ID}`);
  }
  if (!report.matched) return fail('keşifle bulunan agent ile iş tamamlanamadı');

  evidence.discoveredAgent = report.discovered;
  return pass(
    [
      `girdi: skill="${SKILL}" + subgraph adresi (Bob adresi YOK)`,
      `keşif → agentId ${report.discovered.agentId} · ${report.discovered.endpoint}`,
      'iş tamamlandı, match=true',
    ].join('\n'),
  );
});

gate.check('Keşif ile kart uyuşmazlığı SESSİZ geçmiyor', async () => {
  // Subgraph bir anahtar, Bob başka bir anahtar söylerse hangisinin güncel olduğu
  // belirsizdir; Alice yanlış alıcıya şifrelemek yerine durmalı.
  const foreign = createEciesIdentity();
  try {
    await runAliceJob({
      discover: { subgraphUrl: SUBGRAPH_URL, skill: SKILL },
      brief: 'uyuşmazlık testi',
      data: 'x',
      constraints: { model: 'm', maxTokens: 10, temperature: 0 },
      wallet: new ethers.Wallet(cfg.PRIVATE_KEY_ALICE),
      eciesPrivateKey: requireEnv('ALICE_ECIES_PRIV'),
      verifyingContract: PLACEHOLDER_VERIFIER,
      nonce: 4002n,
      log: () => {},
      fetchImpl: async (input, init) => {
        const res = await fetch(input as string, init as RequestInit);
        if (String(input).endsWith('/agent-card.json')) {
          const body = (await res.json()) as Record<string, unknown>;
          // Bob kartında BAŞKA bir anahtar duyuruyor.
          return new Response(JSON.stringify({ ...body, eciesPubKey: foreign.publicKey }), {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return res;
      },
    });
    return fail('kart ile subgraph farklı anahtar söylediği hâlde iş devam etti');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('eciesPubKey')
      ? pass(`durdu: ${msg}`)
      : fail(`beklenen anahtar uyuşmazlığı hatası değil: ${msg}`);
  }
});

// ---------------------------------------------------------------------------
// 3. İkinci agent — arama iki sonuç dönmeli
// ---------------------------------------------------------------------------
let decoyAgentId = '';

gate.check('İkinci (sahte) agent kayıtlı', async () => {
  const cached = optionalEnv('DECOY_AGENT_ID');
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);

  if (cached) {
    const owner = (await registry.ownerOf(cached).catch(() => null)) as string | null;
    if (owner && owner.toLowerCase() === decoyWallet.address.toLowerCase()) {
      decoyAgentId = cached;
      return pass(`.env'den: agentId ${decoyAgentId}`);
    }
  }

  const decoyEcies = createEciesIdentity();
  const write = identityRegistry(cfg.ERC8004_IDENTITY, decoyWallet);
  const tx = await write['register(string,(string,bytes)[])']('ipfs://decoy-agent-card', [
    utf8Metadata(METADATA_KEYS.skill, SKILL),
    utf8Metadata(METADATA_KEYS.endpoint, 'http://127.0.0.1:8899/task'),
    utf8Metadata(METADATA_KEYS.eciesPubKey, decoyEcies.publicKey),
  ]);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) return fail(`register tx başarısız: ${tx.hash}`);

  for (const log of receipt.logs) {
    const parsed = identityRegistryInterface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === 'Registered') decoyAgentId = (parsed.args.agentId as bigint).toString();
  }
  if (!decoyAgentId) return fail('Registered event bulunamadı');

  setEnvValue('DECOY_AGENT_ID', decoyAgentId);
  await readUtf8MetadataUntil(registry, decoyAgentId, METADATA_KEYS.skill, SKILL);
  evidence.decoyRegisterTx = tx.hash;
  return pass(`YENİ kayıt: agentId ${decoyAgentId} · blok ${receipt.blockNumber}\n${BASESCAN}/tx/${tx.hash}`);
});

let ranked: DiscoveredAgent[] = [];

gate.check('Subgraph ikinci agent\'ı indeksledi', async () => {
  // Deploy edilmiş subgraph'ın yeni bloğu yakalamasını bekle.
  for (let i = 0; i < 20; i++) {
    ranked = await discoverBySkill(SUBGRAPH_URL, SKILL);
    if (ranked.some((a) => a.agentId === decoyAgentId)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const meta = await subgraphMeta(SUBGRAPH_URL);
  return ranked.some((a) => a.agentId === decoyAgentId)
    ? pass(`indekslenen blok ${meta.blockNumber} · agentId ${decoyAgentId} aramada görünüyor`)
    : fail(`60 sn içinde indekslenmedi (subgraph blok ${meta.blockNumber})`);
});

gate.check('Arama İKİ sonuç döndürüyor', () => {
  const ids = ranked.map((a) => a.agentId);
  if (!ids.includes(BOB_AGENT_ID)) return fail(`Bob (${BOB_AGENT_ID}) sonuçlarda yok: ${ids.join(', ')}`);
  if (!ids.includes(decoyAgentId)) return fail(`sahte agent (${decoyAgentId}) sonuçlarda yok: ${ids.join(', ')}`);
  evidence.rankedIds = ids;
  return ids.length >= 2
    ? pass(`"${SKILL}" → ${ids.length} sonuç: ${ids.join(', ')}`)
    : fail(`sadece ${ids.length} sonuç`);
});

gate.check('Sıralama verifiedDeliveries\'e göre (azalan) ve deterministik', () => {
  const counts = ranked.map((a) => a.verifiedDeliveries);
  for (let i = 1; i < counts.length; i++) {
    const prev = counts[i - 1] ?? 0;
    const cur = counts[i] ?? 0;
    if (cur > prev) return fail(`sıralama bozuk: ${counts.join(' → ')}`);
  }

  // Eşit sayıda ise daha erken kayıt önde olmalı — aksi hâlde sıralama koşudan
  // koşuya değişir ve demo'da farklı agent seçilir.
  for (let i = 1; i < ranked.length; i++) {
    const a = ranked[i - 1];
    const b = ranked[i];
    if (!a || !b) continue;
    if (a.verifiedDeliveries === b.verifiedDeliveries && BigInt(a.registeredBlock) > BigInt(b.registeredBlock)) {
      return fail(`eşit sayıda ama daha geç kayıt önde: ${a.agentId}(${a.registeredBlock}) > ${b.agentId}(${b.registeredBlock})`);
    }
  }

  const table = ranked
    .map((a) => `  ${a.agentId.padEnd(6)} verified=${a.verifiedDeliveries} rejected=${a.rejectedAttempts} blok=${a.registeredBlock}`)
    .join('\n');

  // DÜRÜSTLÜK: şu an tüm sayaçlar 0, çünkü JobVerified'i yayacak Verifier.sol
  // henüz deploy edilmedi (P3-A). Sıralama MANTIĞI doğrulandı, ayırt edici veri
  // P3-A'dan sonra oluşacak.
  const allZero = counts.every((c) => c === 0);
  return pass(
    [
      table,
      allZero
        ? 'NOT: tüm verifiedDeliveries=0 — sayaç Verifier.sol deploy edilince (P3-A) dolacak.'
        : 'sayaçlar dolu, sıralama gerçek veriyle ayrışıyor.',
      'eşitlikte daha erken kayıt önde (deterministik).',
    ].join('\n'),
  );
});

gate.check('Keşif en yüksek sıradaki agent\'ı seçiyor', async () => {
  const best = ranked[0];
  if (!best) return fail('sonuç yok');
  // Alice `pickBestAgent` ile ilkini alır; bu, çalışan Bob olmalı ki iş yürüsün.
  return best.agentId === BOB_AGENT_ID
    ? pass(`ilk sıra ${best.agentId} (Bob) — Alice bunu seçiyor`)
    : fail(`ilk sıra ${best.agentId}, Bob değil; Alice çalışmayan sahte agent'a giderdi`);
});

gate.check('Kanıt dosyası yazıldı (fixtures/subgraph/P2-C.json)', async () => {
  await bob?.close();
  const dir = resolve(root, 'fixtures/subgraph');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'P2-C.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return pass('fixtures/subgraph/P2-C.json');
});

await gate.run();
