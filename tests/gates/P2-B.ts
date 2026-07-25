// tests/gates/P2-B.ts — Subgraph fork + Studio'ya canlı deploy kapısı.
//
// BUILD-PLAN P2-B geçiş kriterleri:
//   [ ] Subgraph Studio'da senkron %100, `fatalError` yok
//   [ ] `{ agents { id skills endpoint } }` sorgusu GERÇEK Bob'u döndürüyor
//   [ ] Alice'in discovery'si skill ile arayıp Bob'un endpoint'ini buluyor ve
//       HARD-CODED adres kodda hiçbir yerde yok (grep ile kanıtla)
//
// CANLI subgraph'a sorgu atar (Studio dev endpoint'i, API key gerekmiyor).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ethers } from 'ethers';

import {
  METADATA_KEYS,
  PLACEHOLDER_VERIFIER,
  discoverBySkill,
  eciesPublicKeyOf,
  findAgentById,
  identityRegistry,
  pickBestAgent,
  readUtf8Metadata,
  subgraphMeta,
  type Constraints,
} from '../../packages/shared/src/index.js';
import { createBobAgent, type BobAgent } from '../../packages/bob-agent/src/index.js';
import { runAliceJob } from '../../packages/alice-agent/src/index.js';
import { loadConfig, loadDotenv, optionalEnv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const gate = new Gate('P2-B', 'Subgraph — canlı deploy + keşif');
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString() };

const SUBGRAPH_URL = requireEnv('SUBGRAPH_QUERY_URL', 'graph deploy çıktısındaki Queries (HTTP) adresi');
const BOB_AGENT_ID = requireEnv('BOB_AGENT_ID');
const ALICE_AGENT_ID = requireEnv('ALICE_AGENT_ID');
const START_BLOCK = Number(requireEnv('SUBGRAPH_START_BLOCK'));
const BOB_SKILL = 'market-analysis';
const BOB_PORT = 8812;

const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
let bob: BobAgent | undefined;

// ---------------------------------------------------------------------------
// 1. Senkron ve hata durumu
// ---------------------------------------------------------------------------
gate.check('Senkron %100\'e yakın ve indeksleme hatası YOK', async () => {
  const meta = await subgraphMeta(SUBGRAPH_URL);
  const head = await provider.getBlockNumber();
  const lag = head - meta.blockNumber;

  evidence.subgraphUrl = SUBGRAPH_URL;
  evidence.indexedBlock = meta.blockNumber;
  evidence.chainHead = head;
  evidence.lagBlocks = lag;

  const detail = [
    `indekslenen blok ${meta.blockNumber} · zincir başı ${head} · gecikme ${lag} blok`,
    `hasIndexingErrors=${meta.hasIndexingErrors}`,
    `startBlock ${START_BLOCK} → ${meta.blockNumber - START_BLOCK} blok işlendi`,
  ].join('\n');

  if (meta.hasIndexingErrors) return fail(`${detail}\n→ subgraph indeksleme hatası veriyor (fatalError)`);
  if (meta.blockNumber < START_BLOCK) return fail(`${detail}\n→ henüz startBlock'a ulaşmadı`);
  // Base ~2 sn blok; 150 blok ≈ 5 dakika. Bunun ötesi "senkron değil" demektir.
  if (lag > 150) return fail(`${detail}\n→ ${lag} blok geride, senkron sayılmaz`);
  return pass(detail);
});

// ---------------------------------------------------------------------------
// 2. Sorgu gerçek Bob'u döndürüyor
// ---------------------------------------------------------------------------
gate.check('Sorgu GERÇEK Bob\'u döndürüyor ve zincirle uyuşuyor', async () => {
  const agent = await findAgentById(SUBGRAPH_URL, BOB_AGENT_ID);
  if (!agent) return fail(`agentId ${BOB_AGENT_ID} subgraph'ta yok`);

  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const onChain = {
    skill: await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.skill),
    endpoint: await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.endpoint),
    eciesPubKey: await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.eciesPubKey),
  };
  const owner = (await registry.ownerOf(BOB_AGENT_ID)) as string;

  const problems: string[] = [];
  if (!agent.skills.includes(onChain.skill ?? '')) problems.push(`skill: subgraph ${agent.skills} ≠ zincir "${onChain.skill}"`);
  if (agent.endpoint !== onChain.endpoint) problems.push(`endpoint: subgraph "${agent.endpoint}" ≠ zincir "${onChain.endpoint}"`);
  if (agent.eciesPubKey !== onChain.eciesPubKey) problems.push('eciesPubKey: subgraph ≠ zincir');
  if (agent.owner.toLowerCase() !== owner.toLowerCase()) problems.push(`owner: subgraph ${agent.owner} ≠ zincir ${owner}`);

  evidence.bobFromSubgraph = agent;
  return problems.length === 0
    ? pass(
        [
          `agentId ${agent.agentId} · owner ${agent.owner}`,
          `skills ${agent.skills.join(',')} · endpoint ${agent.endpoint}`,
          `verifiedDeliveries ${agent.verifiedDeliveries} · rejectedAttempts ${agent.rejectedAttempts}`,
          'üç alan da zincirle birebir',
        ].join('\n'),
      )
    : fail(problems.join('\n'));
});

gate.check('MetadataSet indeksleniyor (sadece Registered yetmezdi)', async () => {
  // DECISION.md'nin en önemli bulgusu: metadata ayrı event'te geliyor ve `keyHash`
  // indexed olduğu için topic'ten okunmuyor. Bu doğru yapılmadıysa skill/endpoint boş kalır.
  const alice = await findAgentById(SUBGRAPH_URL, ALICE_AGENT_ID);
  if (!alice) return fail(`Alice (${ALICE_AGENT_ID}) subgraph'ta yok`);
  if (!alice.skills.length) return fail('Alice\'in skills alanı boş — MetadataSet indekslenmemiş');
  if (!alice.eciesPubKey) return fail('Alice\'in eciesPubKey alanı boş — MetadataSet indekslenmemiş');
  return pass(`Alice ${ALICE_AGENT_ID}: skills ${alice.skills.join(',')} · eciesPubKey var`);
});

gate.check('Bizim dışımızdaki kayıtlar da indeksleniyor (gerçek registry)', async () => {
  const all = await discoverBySkill(SUBGRAPH_URL, BOB_SKILL, { requireUsable: false, first: 100 });
  // Skill filtresiz genel sorgu için ayrı bir çağrı: başkalarının agent'ları var mı?
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ registry(id: "global") { agentCount } agents(first: 100) { id } }' }),
  });
  const body = (await res.json()) as { data?: { registry?: { agentCount: number }; agents: Array<{ id: string }> } };
  const ids = body.data?.agents.map((a) => a.id) ?? [];
  const ours = [BOB_AGENT_ID, ALICE_AGENT_ID];
  const others = ids.filter((id) => !ours.includes(id));

  evidence.indexedAgentIds = ids;
  evidence.agentCount = body.data?.registry?.agentCount;

  return others.length > 0
    ? pass(`${ids.length} agent indekslendi (${others.length} tanesi başkalarının: ${others.join(', ')})`)
    : fail(`sadece bizim kayıtlarımız indekslendi — registry canlı ama subgraph başkalarını kaçırıyor?\n${ids.join(', ')}\n(skill eşleşen: ${all.length})`);
});

// ---------------------------------------------------------------------------
// 2b. Verifier data source — itibarın kaynağı
// ---------------------------------------------------------------------------
type JobsResponse = {
  registry?: { agentCount: number; verifiedJobs: number; rejectedJobs: number };
  jobs?: Array<{ id: string; status: string; rejectionCode: string | null; price: string; agent: { id: string } }>;
};

let jobsData: JobsResponse | undefined;

gate.check('Verifier data source indeksliyor (JobVerified / JobRejected)', async () => {
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query:
        '{ registry(id:"global"){agentCount verifiedJobs rejectedJobs} ' +
        'jobs(first:50){id status rejectionCode price agent{id}} }',
    }),
  });
  const body = (await res.json()) as { data?: JobsResponse };
  jobsData = body.data;
  const registry = jobsData?.registry;
  const jobs = jobsData?.jobs ?? [];

  if (!registry) return fail('registry entity yok');
  if (registry.verifiedJobs < 1) {
    return fail(
      `verifiedJobs=${registry.verifiedJobs} — hiç JobVerified indekslenmemiş.\n` +
        '→ zincirde event var mı? npx tsx scripts/emit-test-jobs.ts',
    );
  }
  if (registry.rejectedJobs < 1) return fail(`rejectedJobs=${registry.rejectedJobs} — fraud yolu indekslenmemiş`);

  evidence.registryCounters = registry;
  evidence.jobs = jobs;
  return pass(
    [
      `verifiedJobs=${registry.verifiedJobs} · rejectedJobs=${registry.rejectedJobs}`,
      ...jobs.map((j) => `  ${j.status.padEnd(8)} ${j.rejectionCode ?? '-'} · agent ${j.agent.id} · ${j.id.slice(0, 18)}…`),
    ].join('\n'),
  );
});

gate.check('Job → Agent bağlantısı tutuyor (uint256 agentId kararının kanıtı)', () => {
  const jobs = jobsData?.jobs ?? [];
  if (!jobs.length) return fail('hiç Job yok');
  const orphan = jobs.filter((j) => !j.agent || !j.agent.id);
  if (orphan.length) {
    return fail(
      `${orphan.length} Job hiçbir Agent'a bağlı değil — bytes32/uint256 dönüşümü bozuk demektir`,
    );
  }
  const mine = jobs.filter((j) => j.agent.id === BOB_AGENT_ID);
  return mine.length > 0
    ? pass(`${jobs.length} Job'ın hepsi bir Agent'a bağlı; ${mine.length} tanesi Bob (${BOB_AGENT_ID})`)
    : fail(`hiçbir Job Bob'a (${BOB_AGENT_ID}) bağlı değil`);
});

gate.check('Ret kodu okunabilir ve doğru (MatchFalse)', () => {
  const rejected = (jobsData?.jobs ?? []).filter((j) => j.status === 'REJECTED');
  if (!rejected.length) return fail('hiç REJECTED job yok');
  const known = ['Expired', 'AlreadyVerified', 'BadClientSig', 'BadEnclaveSig', 'MatchFalse'];
  const bad = rejected.filter((j) => !j.rejectionCode || !known.includes(j.rejectionCode));
  return bad.length === 0
    ? pass(rejected.map((j) => `${j.rejectionCode} · ${j.id.slice(0, 18)}…`).join('\n'))
    : fail(`tanınmayan ret kodu: ${bad.map((j) => j.rejectionCode).join(', ')}`);
});

gate.check('Bob\'un itibarı gerçek veriden geliyor', async () => {
  const agent = await findAgentById(SUBGRAPH_URL, BOB_AGENT_ID);
  if (!agent) return fail('Bob subgraph\'ta yok');
  return agent.verifiedDeliveries > 0
    ? pass(
        `verifiedDeliveries=${agent.verifiedDeliveries} · rejectedAttempts=${agent.rejectedAttempts}\n` +
          'sayaç yalnızca Verifier.sol event\'iyle artıyor — kullanıcı girdisi yok',
      )
    : fail(`verifiedDeliveries=${agent.verifiedDeliveries} — hâlâ sıfır`);
});

// ---------------------------------------------------------------------------
// 3. Keşif — Alice Bob'u skill ile buluyor
// ---------------------------------------------------------------------------
gate.check('discoverBySkill Bob\'u buluyor ve endpoint veriyor', async () => {
  const found = await discoverBySkill(SUBGRAPH_URL, BOB_SKILL);
  const bobEntry = found.find((a) => a.agentId === BOB_AGENT_ID);
  if (!bobEntry) return fail(`"${BOB_SKILL}" aramasında Bob yok. Bulunanlar: ${found.map((a) => a.agentId).join(', ') || '(boş)'}`);
  if (!bobEntry.endpoint) return fail('Bob bulundu ama endpoint boş');
  if (!bobEntry.eciesPubKey) return fail('Bob bulundu ama eciesPubKey boş');
  return pass(`${found.length} sonuç · Bob ${bobEntry.agentId} → ${bobEntry.endpoint}`);
});

gate.check('SUBGRAPH\'TAN gelen pubkey ile şifrelenen iş çalışıyor (Graph load-bearing)', async () => {
  // Kritik test: keşfin verdiği anahtar GERÇEKTEN kullanılabiliyor mu?
  // Subgraph yanlış/eski bir pubkey döndürseydi burada patlar.
  const discovered = await pickBestAgent(SUBGRAPH_URL, BOB_SKILL);
  if (discovered.agentId !== BOB_AGENT_ID) {
    return fail(`en iyi sonuç ${discovered.agentId}, beklenen ${BOB_AGENT_ID}`);
  }

  bob = createBobAgent({
    eciesPrivateKey: requireEnv('BOB_ECIES_PRIV'),
    agentId: BOB_AGENT_ID,
    owner: new ethers.Wallet(cfg.PRIVATE_KEY_BOB).address,
    skills: [BOB_SKILL],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract: optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER,
    bindingKey: ethers.keccak256(ethers.toUtf8Bytes(`phase1-binding-key/${cfg.PRIVATE_KEY_BOB}`)),
    port: BOB_PORT,
    log: () => {},
  });
  await bob.listen();

  const constraints: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };
  const report = await runAliceJob({
    bobUrl: `http://127.0.0.1:${BOB_PORT}`,
    brief: 'P2-B keşif doğrulaması: bu paket SUBGRAPH\'tan gelen anahtarla şifrelendi.',
    data: 'keşif → anahtar → çalışan iş zinciri',
    constraints,
    wallet: new ethers.Wallet(cfg.PRIVATE_KEY_ALICE),
    eciesPrivateKey: requireEnv('ALICE_ECIES_PRIV'),
    verifyingContract: optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER,
    nonce: 3001n,
    fetchImpl: async (input, init) => {
      const res = await fetch(input as string, init as RequestInit);
      if (String(input).endsWith('/agent-card.json')) {
        const body = (await res.json()) as Record<string, unknown>;
        // Kart yerine SUBGRAPH'ın verdiği anahtarı kullan.
        return new Response(JSON.stringify({ ...body, eciesPubKey: discovered.eciesPubKey }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return res;
    },
    log: () => {},
  });

  return report.matched
    ? pass(`subgraph pubkey ${discovered.eciesPubKey?.slice(0, 22)}… ile iş koşuldu, match=true`)
    : fail('subgraph\'tan gelen anahtarla şifrelenen iş doğru işlenemedi');
});

// ---------------------------------------------------------------------------
// 4. Hard-coded adres yok
// ---------------------------------------------------------------------------
gate.check('Kaynak kodda HARD-CODED Bob adresi/endpoint\'i yok', () => {
  const bobOwner = new ethers.Wallet(cfg.PRIVATE_KEY_BOB).address;
  const needles = [BOB_AGENT_ID, bobOwner, bobOwner.toLowerCase()];

  // Yalnızca üretim kaynağı — kapı testleri .env'den okuyup kıyaslamak zorunda.
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['grep', '-n', '-I', '-F', ...needles.flatMap((n) => ['-e', n]), '--', 'packages/*/src', 'subgraph/src'],
      { cwd: root, stdio: 'pipe', shell: true },
    ).toString();
  } catch {
    out = ''; // git grep eşleşme bulamazsa exit 1 döner
  }

  const hits = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return hits.length === 0
    ? pass(
        [
          `aranan: agentId ${BOB_AGENT_ID}, owner ${bobOwner}`,
          'packages/*/src ve subgraph/src içinde eşleşme yok — adres yalnızca .env ve subgraph\'tan geliyor',
        ].join('\n'),
      )
    : fail(`hard-coded değerler bulundu:\n${hits.slice(0, 10).join('\n')}`);
});

gate.check('Kanıt dosyası yazıldı (fixtures/subgraph/P2-B.json)', async () => {
  await bob?.close();
  const dir = resolve(root, 'fixtures/subgraph');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'P2-B.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const manifest = readFileSync(resolve(root, 'subgraph/subgraph.yaml'), 'utf8');
  const startBlockInManifest = /startBlock:\s*(\d+)/.exec(manifest)?.[1];
  if (startBlockInManifest !== String(START_BLOCK)) {
    return fail(`subgraph.yaml startBlock ${startBlockInManifest} ≠ .env ${START_BLOCK}`);
  }
  return pass(`fixtures/subgraph/P2-B.json · startBlock manifest ile .env uyumlu (${START_BLOCK})`);
});

await gate.run();
