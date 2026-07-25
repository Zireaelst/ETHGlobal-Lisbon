// tests/gates/P0-F.ts — ERC-8004 kayıt + okuma kapısı (Base Sepolia).
//
// BUILD-PLAN P0-F geçiş kriterleri:
//   [ ] register tx'i Basescan'de başarılı, agentId döndü
//   [ ] Bağımsız bir okuma scripti kayıtlı endpoint'i geri veriyor
//   [ ] (a)/(b) kararı verildi ve subgraph/DECISION.md'ye yazıldı
//   [ ] Kayıt event'inin BLOK NUMARASI not edildi (subgraph startBlock'u bu olacak)
//
// U3'ü kapatır: registry canlı mı, on-chain metadata var mı yoksa sadece URI mi.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import {
  METADATA_KEYS,
  identityRegistry,
  identityRegistryInterface,
  readUtf8Metadata,
  readUtf8MetadataUntil,
  utf8Metadata,
} from '../../packages/shared/src/identity.js';
import { loadConfig, loadDotenv, optionalEnv, repoRoot } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';
import { setEnvValue } from './_env-write.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const BASESCAN = 'https://sepolia.basescan.org';
/** Base Sepolia RPC'si eth_getLogs'u 2000 blokla sınırlıyor. */
const LOG_CHUNK = 2000;

const gate = new Gate('P0-F', 'ERC-8004 kayıt + okuma (Base Sepolia)');
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString() };

const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);

type AgentRecord = {
  who: 'Alice' | 'Bob';
  address: string;
  agentId: string;
  registeredBlock: number;
  txHash: string;
  fresh: boolean;
};
const agents: AgentRecord[] = [];

// ---------------------------------------------------------------------------
// 1. U3 — registry gerçekten canlı mı?
// ---------------------------------------------------------------------------
gate.check('Registry Base Sepolia\'da canlı (kod var, event akıyor)', async () => {
  const net = await provider.getNetwork();
  if (net.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    return fail(`chainId ${net.chainId}, beklenen ${BASE_SEPOLIA_CHAIN_ID} (BASE_RPC_URL yanlış ağa bakıyor)`);
  }
  const code = await provider.getCode(cfg.ERC8004_IDENTITY);
  if (code === '0x') return fail(`${cfg.ERC8004_IDENTITY} adresinde kod yok — registry ölü`);

  // "Event akıyor" = başkaları da kullanıyor, ölü bir referans deployment değil.
  const head = await provider.getBlockNumber();
  const topic = ethers.id('Registered(uint256,string,address)');
  let seen = 0;
  for (let to = head; to > head - LOG_CHUNK * 5 && seen === 0; to -= LOG_CHUNK) {
    const logs = await provider
      .getLogs({ address: cfg.ERC8004_IDENTITY, fromBlock: to - (LOG_CHUNK - 1), toBlock: to, topics: [topic] })
      .catch(() => []);
    seen += logs.length;
  }

  evidence.chainId = net.chainId.toString();
  evidence.registry = cfg.ERC8004_IDENTITY;
  evidence.registryCodeBytes = (code.length - 2) / 2;
  evidence.headBlock = head;

  const detail = [
    `chainId ${net.chainId} · ${cfg.ERC8004_IDENTITY}`,
    `kod ${(code.length - 2) / 2} byte (UUPS proxy — subgraph proxy adresini indeksler)`,
    `son ~${LOG_CHUNK * 5} blokta ${seen} Registered event`,
    `${BASESCAN}/address/${cfg.ERC8004_IDENTITY}`,
  ];
  return seen > 0
    ? pass(detail.join('\n'))
    : fail(`${detail.join('\n')}\n→ hiç event yok; registry ölü olabilir, referans kontratı kendimiz deploy etmeliyiz`);
});

// ---------------------------------------------------------------------------
// 2. Kayıt — Alice ve Bob. Mevcut kayıt varsa yeniden mint etme.
// ---------------------------------------------------------------------------

/** .env'de kayıtlı agentId'yi doğrula; sahibi eşleşmiyorsa yok say. */
async function verifyCached(agentId: string, owner: string): Promise<boolean> {
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const actual = (await registry.ownerOf(agentId).catch(() => null)) as string | null;
  return actual !== null && actual.toLowerCase() === owner.toLowerCase();
}

/** Registered event'lerini owner'a göre geriye tarayarak mevcut kaydı bul. */
async function findExisting(owner: string, head: number): Promise<{ agentId: string; block: number; tx: string } | null> {
  const topic = ethers.id('Registered(uint256,string,address)');
  const ownerTopic = ethers.zeroPadValue(owner, 32);
  for (let to = head; to > head - LOG_CHUNK * 30; to -= LOG_CHUNK) {
    const logs = await provider
      .getLogs({
        address: cfg.ERC8004_IDENTITY,
        fromBlock: to - (LOG_CHUNK - 1),
        toBlock: to,
        topics: [topic, null, ownerTopic],
      })
      .catch(() => []);
    const last = logs.at(-1);
    if (last) {
      const parsed = identityRegistryInterface.parseLog({ topics: [...last.topics], data: last.data });
      return {
        agentId: (parsed?.args.agentId as bigint).toString(),
        block: last.blockNumber,
        tx: last.transactionHash,
      };
    }
  }
  return null;
}

async function ensureRegistered(
  who: 'Alice' | 'Bob',
  privateKey: string,
  envKey: 'ALICE_AGENT_ID' | 'BOB_AGENT_ID',
  metadata: Array<{ metadataKey: string; metadataValue: string }>,
  agentURI: string,
): Promise<string> {
  const wallet = new ethers.Wallet(privateKey, provider);
  const head = await provider.getBlockNumber();

  const cached = optionalEnv(envKey);
  if (cached && (await verifyCached(cached, wallet.address))) {
    const found = await findExisting(wallet.address, head);
    agents.push({
      who,
      address: wallet.address,
      agentId: cached,
      registeredBlock: found?.block ?? 0,
      txHash: found?.tx ?? '',
      fresh: false,
    });
    return `.env'den doğrulandı: agentId ${cached} (owner eşleşiyor)`;
  }

  const existing = await findExisting(wallet.address, head);
  if (existing) {
    setEnvValue(envKey, existing.agentId);
    agents.push({
      who,
      address: wallet.address,
      agentId: existing.agentId,
      registeredBlock: existing.block,
      txHash: existing.tx,
      fresh: false,
    });
    return `zincirde mevcut kayıt bulundu: agentId ${existing.agentId} (blok ${existing.block}) — yeniden mint edilmedi`;
  }

  const registry = identityRegistry(cfg.ERC8004_IDENTITY, wallet);
  const tx = await registry['register(string,(string,bytes)[])'](agentURI, metadata);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`register tx başarısız: ${tx.hash}`);

  let agentId: string | undefined;
  for (const log of receipt.logs) {
    const parsed = identityRegistryInterface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === 'Registered') agentId = (parsed.args.agentId as bigint).toString();
  }
  if (!agentId) throw new Error('receipt loglarında Registered event yok');

  setEnvValue(envKey, agentId);
  agents.push({
    who,
    address: wallet.address,
    agentId,
    registeredBlock: receipt.blockNumber,
    txHash: tx.hash,
    fresh: true,
  });
  return `YENİ kayıt: agentId ${agentId} · blok ${receipt.blockNumber}\n${BASESCAN}/tx/${tx.hash}`;
}

// Not: buradaki metadata YER TUTUCU — gerçek skill/endpoint/eciesPubKey P2-A'da yazılır
// (registry `setMetadata` destekliyor, yeniden kayıt gerekmiyor).
gate.check('Bob kayıtlı (agentId .env\'de)', async () => {
  const detail = await ensureRegistered(
    'Bob',
    cfg.PRIVATE_KEY_BOB,
    'BOB_AGENT_ID',
    [
      utf8Metadata(METADATA_KEYS.skill, 'market-analysis'),
      utf8Metadata(METADATA_KEYS.endpoint, 'https://bob-agent.invalid/task'),
      utf8Metadata(METADATA_KEYS.eciesPubKey, 'placeholder-P1B'),
    ],
    'ipfs://placeholder-bob-agent-card',
  );
  return pass(detail);
});

gate.check('Alice kayıtlı (registeredClient kontrolü buna bakacak)', async () => {
  const detail = await ensureRegistered(
    'Alice',
    cfg.PRIVATE_KEY_ALICE,
    'ALICE_AGENT_ID',
    [
      utf8Metadata(METADATA_KEYS.skill, 'client'),
      utf8Metadata(METADATA_KEYS.eciesPubKey, 'placeholder-P1B'),
    ],
    'ipfs://placeholder-alice-agent-card',
  );
  return pass(detail);
});

gate.check('register tx\'i Basescan\'de başarılı (status=1)', async () => {
  if (agents.length !== 2) return fail(`2 agent bekleniyordu, ${agents.length} var`);
  const lines: string[] = [];
  for (const a of agents) {
    if (!a.txHash) {
      lines.push(`${a.who}: agentId ${a.agentId} — tx hash bulunamadı (tarama penceresi dışında)`);
      continue;
    }
    const receipt = await provider.getTransactionReceipt(a.txHash);
    if (!receipt) return fail(`${a.who}: ${a.txHash} receipt'i alınamadı`);
    if (receipt.status !== 1) return fail(`${a.who}: tx status=${receipt.status}\n${BASESCAN}/tx/${a.txHash}`);
    lines.push(`${a.who}: agentId ${a.agentId} · blok ${receipt.blockNumber} · status=1\n  ${BASESCAN}/tx/${a.txHash}`);
  }
  evidence.agents = agents;
  return pass(lines.join('\n'));
});

// ---------------------------------------------------------------------------
// 3. Bağımsız okuma — kayıt akışının nesnelerini DEĞİL, taze bağlantıyı kullan
// ---------------------------------------------------------------------------
gate.check('Bağımsız okuma kayıtlı endpoint\'i geri veriyor', async () => {
  const bob = agents.find((a) => a.who === 'Bob');
  if (!bob) return fail('Bob kaydı yok');

  // Taze provider + taze contract: yukarıdaki kayıt akışından hiçbir nesne taşınmıyor.
  const freshProvider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, freshProvider);

  const owner = (await registry.ownerOf(bob.agentId)) as string;
  const endpoint = await readUtf8Metadata(registry, bob.agentId, METADATA_KEYS.endpoint);
  const skill = await readUtf8Metadata(registry, bob.agentId, METADATA_KEYS.skill);
  const agentWallet = await readUtf8Metadata(registry, bob.agentId, METADATA_KEYS.agentWallet).catch(() => undefined);

  if (owner.toLowerCase() !== bob.address.toLowerCase()) {
    return fail(`ownerOf(${bob.agentId}) = ${owner}, beklenen ${bob.address}`);
  }
  if (!endpoint) return fail(`agentId ${bob.agentId} için 'endpoint' metadata'sı boş`);

  evidence.readBack = { agentId: bob.agentId, owner, endpoint, skill, agentWallet };
  return pass(
    [
      `agentId ${bob.agentId}`,
      `owner    ${owner}`,
      `skill    ${skill ?? '-'}`,
      `endpoint ${endpoint}`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 4. (a) kararının çalışabilirliği — metadata GÜNCELLENEBİLİR mi?
// ---------------------------------------------------------------------------
// Bu kriter plandaki listede yok ama (a) kararı buna dayanıyor: P2-A gerçek
// skill/endpoint/pubkey'i yazacak. Güncellenemiyorsa (a) yanlış karar olur ve
// her değişiklikte yeniden kayıt gerekir — bunu P2-A'da değil ŞİMDİ öğrenelim.
gate.check('Metadata güncellenebilir (setMetadata) — (a) kararı uygulanabilir', async () => {
  const bob = agents.find((a) => a.who === 'Bob');
  if (!bob) return fail('Bob kaydı yok');

  const wallet = new ethers.Wallet(cfg.PRIVATE_KEY_BOB, provider);
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, wallet);
  const probeKey = 'gateProbe';
  const probeValue = `P0-F-${Date.now()}`;

  const tx = await registry.getFunction('setMetadata')(bob.agentId, probeKey, ethers.toUtf8Bytes(probeValue));
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) return fail(`setMetadata tx başarısız: ${tx.hash}`);

  // Yazmanın kanıtı işlemin KENDİ event'i — RPC replika gecikmesinden etkilenmez.
  const emitted = receipt.logs
    .map((l: { topics: readonly string[]; data: string }) =>
      identityRegistryInterface.parseLog({ topics: [...l.topics], data: l.data }),
    )
    .find((p) => p?.name === 'MetadataSet');
  if (!emitted) return fail(`tx ${tx.hash} MetadataSet event'i yaymadı`);
  const emittedKey = emitted.args.key as string;
  const emittedValue = ethers.toUtf8String(emitted.args.value as string);
  if (emittedKey !== probeKey || emittedValue !== probeValue) {
    return fail(`MetadataSet beklenenden farklı: key="${emittedKey}" value="${emittedValue}"`);
  }

  // Okuma tutarlılığı ayrı bir iş: public RPC yük dengeli, taze yazmayı görmeyen
  // bir replikaya düşebiliyor. Bu yüzden eşleşene kadar yeniden deniyoruz.
  const readBack = await readUtf8MetadataUntil(
    identityRegistry(cfg.ERC8004_IDENTITY, provider),
    bob.agentId,
    probeKey,
    probeValue,
  );
  if (readBack !== probeValue) {
    return fail(
      `on-chain yazma doğrulandı (MetadataSet) ama okuma 15 sn içinde yakalayamadı:\n` +
        `  beklenen "${probeValue}", okunan "${readBack}"\n` +
        `  → RPC replika gecikmesi; BASE_RPC_URL'i özel bir sağlayıcıya çevirmeyi düşün`,
    );
  }

  evidence.metadataUpdatable = true;
  return pass(
    `setMetadata("${probeKey}") → MetadataSet yayıldı ve değer geri okundu\n${BASESCAN}/tx/${tx.hash}`,
  );
});

// ---------------------------------------------------------------------------
// 5. subgraph startBlock — yanlışsa subgraph BOŞ indeksler
// ---------------------------------------------------------------------------
gate.check('startBlock not edildi (.env SUBGRAPH_START_BLOCK)', () => {
  const blocks = agents.map((a) => a.registeredBlock).filter((b) => b > 0);
  if (!blocks.length) return fail('hiçbir kaydın blok numarası bilinmiyor');
  // İki kaydın ERKENİ — daha ileri bir blok seçersek subgraph erken kaydı kaçırır.
  const startBlock = Math.min(...blocks);
  setEnvValue('SUBGRAPH_START_BLOCK', String(startBlock));
  evidence.subgraphStartBlock = startBlock;
  return pass(
    [
      `startBlock = ${startBlock} (kayıtların en erkeni)`,
      ...agents.map((a) => `  ${a.who}: blok ${a.registeredBlock || '?'}`),
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 6. (a)/(b) kararı yazılı
// ---------------------------------------------------------------------------
gate.check('(a)/(b) kararı subgraph/DECISION.md\'ye yazıldı', () => {
  const bob = agents.find((a) => a.who === 'Bob');
  const alice = agents.find((a) => a.who === 'Alice');
  const startBlock = evidence.subgraphStartBlock ?? '?';

  const doc = `# P0-F kararı — ERC-8004 metadata: (a) on-chain key/value

> Bu dosyayı \`pnpm gate:P0-F\` üretir. Elle düzenlenirse kapı bir sonraki koşuda üzerine yazar.

## Karar: **(a)** — metadata doğrudan zincirde

BUILD-PLAN P0-F iki seçenek sunuyordu. Base Sepolia'daki canlı registry
\`${cfg.ERC8004_IDENTITY}\` **(a)**'yı destekliyor, o yüzden (a) seçildi:

- \`register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata)\`
  kayıt anında keyfi key/value metadata yazıyor.
- \`setMetadata(uint256 agentId, string key, bytes value)\` ile **sonradan güncellenebiliyor**
  — kapı bunu her koşuda canlı yazıp geri okuyarak kanıtlıyor. Yani P2-A gerçek
  skill/endpoint/eciesPubKey'i yeniden kayıt yapmadan yazabilir.

Sonuç: \`skill\`, \`endpoint\`, \`eciesPubKey\`, \`stealthMetaAddress\` zincirde durur;
subgraph hepsini indeksler. Agent card'ı HTTP'den çekmeye **gerek yok** (b yolu düştü).

## Subgraph için bağlayıcı bulgular

| Alan | Değer |
|---|---|
| Ağ | \`base-sepolia\` (chainId ${evidence.chainId ?? '84532'}) |
| Registry adresi | \`${cfg.ERC8004_IDENTITY}\` |
| Kontrat tipi | UUPS proxy (~${evidence.registryCodeBytes ?? '130'} byte kod) — **proxy adresi indekslenir**, implementasyon değişse de sabit |
| \`startBlock\` | **${startBlock}** |

### İndekslenecek event'ler

\`\`\`
Registered(uint256 indexed agentId, string agentURI, address indexed owner)
MetadataSet(uint256 indexed agentId, string indexed keyHash, string key, bytes value)
URIUpdated(uint256 indexed agentId, string agentURI, address indexed owner)
Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
\`\`\`

**Dikkat — \`MetadataSet\` tuzağı:** \`keyHash\` \`indexed string\` olduğu için topic'te anahtarın
**hash'i** durur, okunabilir hâli değil. Mapping'de \`event.params.key\` (non-indexed) kullanılmalı;
\`keyHash\` üzerinden eşleştirmeye çalışmak sessizce boş metadata üretir.

Canlı bir \`register()\` tx'i şu logları yayıyor (blok ${bob?.registeredBlock ?? '?'} örneği):
\`Transfer\` (mint) → \`MetadataUpdate\` → \`Registered\` → her anahtar için bir \`MetadataSet\`.
Registry ayrıca istemediğimiz hâlde bir \`agentWallet\` metadata'sı ekliyor (değeri = owner adresi).

## Kayıtlı kimlikler

| Agent | agentId | Adres | Kayıt bloğu |
|---|---|---|---|
| Bob | \`${bob?.agentId ?? '-'}\` | \`${bob?.address ?? '-'}\` | ${bob?.registeredBlock || '?'} |
| Alice | \`${alice?.agentId ?? '-'}\` | \`${alice?.address ?? '-'}\` | ${alice?.registeredBlock || '?'} |

Metadata şu an **yer tutucu**. Gerçek değerleri P2-A yazacak — \`setMetadata\` ile, yeniden kayıt yok.
`;

  const dir = resolve(root, 'subgraph');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'DECISION.md'), doc, 'utf8');
  return pass('subgraph/DECISION.md — karar (a), startBlock ve MetadataSet tuzağı yazıldı');
});

gate.check('Kanıt dosyası yazıldı (fixtures/erc8004/P0-F.json)', () => {
  const dir = resolve(root, 'fixtures/erc8004');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'P0-F.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return pass('fixtures/erc8004/P0-F.json');
});

await gate.run();
