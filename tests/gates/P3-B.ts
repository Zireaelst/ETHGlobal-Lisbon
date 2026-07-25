// tests/gates/P3-B.ts — Bob'un binding agent'ı + GERÇEK 0G Sealed Inference.
//
// BUILD-PLAN P3-B geçiş kriterleri:
//   [ ] Dürüst iş: match === true, ogSig doğrulanıyor, gövde imzalanıyor
//   [ ] substitute: match === false dönüyor ve YİNE DE imzalanıyor (enclave dürüstlüğü)
//   [ ] Gövde byte'ları abi.decode ile geri çözülüyor, alanlar birebir eşleşiyor
//   [ ] Replay modu (REPLAY_0G=1) çalışıyor — faucet yakmadan iterasyon
//   [ ] Enclave'in ağ çıkışı SADECE 0G (imageHash iddiasını kirletmemek için)
//   [ ] Tek çağrı p95 < 60 sn (P0-G bütçesi)
//
// Bu kapı CANLI 0G çağrısı yapar (bütçeden ~6 çağrı; P0-D'ye göre ~0.0024 OG).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { runBinding, decodeBody, recoverBindingSigner } from '../../packages/bob-binding/src/binding.js';
import {
  buildIntentHash,
  eciesPublicKeyOf,
  encryptFor,
  decryptWith,
  signIntent,
  intentToWire,
  agentIdToBytes32,
  selectComputeBackend,
  createFixtureComputeBackend,
  type Constraints,
  type Intent,
} from '../../packages/shared/src/index.js';
import { loadConfig, loadDotenv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();
const gate = new Gate('P3-B', 'Binding agent + gerçek 0G Sealed Inference');

const CHAIN_ID = 84532;
const VERIFIER = requireEnv('VERIFIER_ADDRESS');
const OG_DIR = resolve(root, 'fixtures/og');

/** BUILD-PLAN P0-G: uçtan uca 60 sn. Tek compute çağrısı bunu tek başına yememeli. */
const P95_BUDGET_MS = 60_000;
/** p95 için örneklem. Bütçe 12.400 çağrı olduğundan bu maliyet ihmal edilebilir. */
const LATENCY_SAMPLES = 5;

const enclaveKeys = {
  ecies: requireEnv('BOB_ECIES_PRIV'),
  binding: ethers.keccak256(ethers.toUtf8Bytes(`phase1-binding-key/${cfg.PRIVATE_KEY_BOB}`)),
};

const constraints: Constraints = { model: 'qwen/qwen2.5-omni-7b', maxTokens: 256, temperature: 0.2 };
const BRIEF = 'Summarise the covenant risk in the attached filing in three sentences.';
const DATA = 'ACME Corp Q3-2026: revenue 41.2M, deferred revenue up 38% QoQ, DSO 71 days.';

const aliceWallet = new ethers.Wallet(cfg.PRIVATE_KEY_ALICE);

/**
 * Alice'in yapacağı şeyin aynısını kur.
 *
 * `tamper` verilirse zarf İMZADAN SONRA bozulur — gerçek bir saldırganın
 * yapabileceği tek şey bu; imzanın kendisini üretemez.
 */
async function buildEnvelope(tamper?: (e: Record<string, unknown>) => Record<string, unknown>) {
  const nonce = BigInt(Date.now());
  const price = 1000000n;
  const intentHash = buildIntentHash({ brief: BRIEF, data: DATA, constraints, price, nonce });
  const intent: Intent = {
    intentHash,
    client: aliceWallet.address,
    agentId: agentIdToBytes32(requireEnv('BOB_AGENT_ID')),
    price,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };
  const aliceSig = await signIntent(intent, aliceWallet, VERIFIER, CHAIN_ID);

  let envelope: Record<string, unknown> = {
    v: 1,
    intent: intentToWire(intent),
    aliceSig,
    brief: BRIEF,
    data: DATA,
    constraints,
    nonce: nonce.toString(),
    replyPubKey: eciesPublicKeyOf(requireEnv('ALICE_ECIES_PRIV')),
  };
  if (tamper) envelope = tamper(envelope);

  return {
    intentHash,
    request: {
      cipher: await encryptFor(eciesPublicKeyOf(requireEnv('BOB_ECIES_PRIV')), envelope),
      agentId: requireEnv('BOB_AGENT_ID'),
      sealId: 'gate-p3b',
      timestamp: String(Date.now()),
      verifyingContract: VERIFIER,
      chainId: CHAIN_ID,
    },
  };
}

async function liveBackend() {
  const { backend, reason } = await selectComputeBackend(
    { OG_RPC_URL: cfg.OG_RPC_URL, OG_PRIVATE_KEY: process.env.OG_PRIVATE_KEY, OG_PROVIDER_ADDRESS: process.env.OG_PROVIDER_ADDRESS },
    { fixtureDir: OG_DIR, recordDir: OG_DIR },
  );
  if (backend.provider !== '0g-sealed-inference') {
    throw new Error(`canlı backend beklendi, seçilen: ${backend.provider} (${reason})`);
  }
  return backend;
}

// Ölçümleri kriterler arasında paylaşıyoruz — her kriter yeniden çağrı yapmasın.
const latencies: number[] = [];

// ---------------------------------------------------------------------------
// 1. Dürüst iş — canlı 0G
// ---------------------------------------------------------------------------
gate.check('Dürüst iş: match=true, 0G imzası ENCLAVE İÇİNDE doğrulandı, gövde imzalandı', async () => {
  const { intentHash, request } = await buildEnvelope();
  const started = Date.now();
  const result = await runBinding(request, enclaveKeys, { compute: await liveBackend() });
  latencies.push(Date.now() - started);

  if (!result.match) return fail(`match=false — dürüst işte uyuşmalıydı`);
  if (result.computeProvider !== '0g-sealed-inference') {
    return fail(`compute sağlayıcısı "${result.computeProvider}" — canlı 0G bekleniyordu`);
  }
  if (!result.ogVerified) return fail('ogVerified=false — TEE imzası enclave içinde doğrulanamadı');
  if (!result.seal || !result.bodyHex) return fail('gövde imzalanmamış');

  // İmza gerçekten enclave'in binding anahtarına mı ait?
  const expected = new ethers.Wallet(enclaveKeys.binding).address;
  const signer = recoverBindingSigner(result.bodyHex, result.seal, expected);
  if (signer.toLowerCase() !== expected.toLowerCase()) {
    return fail(`gövde imzacısı ${signer}, beklenen ${expected}`);
  }

  return pass(
    [
      `match=true · ogVerified=true · imzacı ${signer.slice(0, 10)}…`,
      `intentHash ${intentHash.slice(0, 14)}…`,
      `outputHash ${result.outputHash.slice(0, 14)}… · ogSigner ${result.ogSigner?.slice(0, 10) ?? '-'}…`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 1b. LEVEL 0 BAĞLAMA — taahhüt 0G TEE'sinin İÇİNDEN geçiyor
//
// Kendi attested makinemiz yok (P0-C/P3-C, TDX erişimi yok). Bu yüzden bağlamanın
// bir ucunu 0G'nin GERÇEK enclave'inin içinden geçiriyoruz: intentHash prompt'a
// konuyor, model çıktısında birebir tekrarlıyor, TEE de o çıktıyı kapsayan gövdeyi
// imzalıyor. Bob bu zinciri kendi makinesinde üretemez.
// ---------------------------------------------------------------------------
gate.check('Çıktı Alice\'in intentHash\'ini BİREBİR taşıyor (Level 0 bağlama)', async () => {
  const { intentHash, request } = await buildEnvelope();
  const started = Date.now();
  const result = await runBinding(request, enclaveKeys, { compute: await liveBackend() });
  latencies.push(Date.now() - started);

  if (!result.intentEchoed) {
    return fail('çıktı intentHash\'i taşımıyor — Level 0 bağlaması kurulmadı');
  }
  if (!result.ogVerified || !result.ogSig) {
    return fail('taahhüt taşınıyor ama TEE imzası doğrulanmadı — zincirin ilk halkası eksik');
  }

  // İmzayı atanın, kontratta ONAYLI TEE olduğunu bağımsız teyit et: enclave'in
  // "ogVerified" raporuna değil, kaydedilmiş beklenen imzacıya karşı bakıyoruz.
  const expectedTee = (
    JSON.parse(
      readFileSync(resolve(OG_DIR, 'signer.json'), 'utf8'),
    ) as { expectedSigner: string }
  ).expectedSigner;
  if (result.ogSigner?.toLowerCase() !== expectedTee.toLowerCase()) {
    return fail(`imzacı ${result.ogSigner} ≠ onaylı TEE ${expectedTee}`);
  }

  return pass(
    [
      `intentHash ${intentHash.slice(0, 18)}… çıktının İÇİNDE`,
      `imzacı ${result.ogSigner.slice(0, 12)}… = kontratta onaylı TEE`,
      'zincir: 0G TEE imzası → yanıt gövdesi → çıktı → intentHash → Alice\'in imzası',
    ].join('\n'),
  );
});

gate.check('Kontrol "DOĞRU hash var mı" diye soruyor — yabancı hash geçmiyor', async () => {
  const { intentHash, request } = await buildEnvelope();
  const result = await runBinding(request, enclaveKeys, { compute: await liveBackend() });

  // `output` dış katmana DÖNMÜYOR (gizlilik sınırı) — Alice'in yaptığını yapıp
  // sonucu onun anahtarıyla çözüyoruz.
  const decrypted = (await decryptWith(requireEnv('ALICE_ECIES_PRIV'), result.resultCipher)) as {
    output: string;
  };

  if (!decrypted.output.includes(intentHash)) {
    return fail('çözülen çıktı gerçek intentHash\'i taşımıyor');
  }

  // Kontrol "herhangi bir hash var mı" olsaydı yabancı bir hash de geçerdi.
  const foreign = ethers.keccak256(ethers.toUtf8Bytes('başka bir sipariş'));
  if (foreign === intentHash) return fail('test kurgusu hatalı: yabancı hash gerçek hash\'e eşit');
  if (decrypted.output.includes(foreign)) {
    return fail('yabancı hash de çıktıda — bağlama ayırt etmiyor');
  }

  return pass(
    [
      `gerçek  ${intentHash.slice(0, 16)}… → çıktıda VAR (intentEchoed=${result.intentEchoed})`,
      `yabancı ${foreign.slice(0, 16)}… → çıktıda YOK`,
      'çıktı Alice\'in anahtarıyla çözüldü — dış katman bunu göremiyor',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 2. Enclave YALAN SÖYLEMEZ — uyuşmazlıkta da imzalar
// ---------------------------------------------------------------------------
gate.check('substitute: match=false dönüyor ve YİNE DE imzalanıyor', async () => {
  // İmza atıldıktan SONRA brief'i değiştiriyoruz → yeniden hesaplanan taahhüt
  // Alice'in imzaladığıyla tutmayacak.
  const { request } = await buildEnvelope((e) => ({ ...e, brief: `${BRIEF} (değiştirildi)` }));
  const started = Date.now();
  const result = await runBinding(request, enclaveKeys, { compute: await liveBackend() });
  latencies.push(Date.now() - started);

  if (result.match) return fail('içerik değişmesine rağmen match=true — recompute çalışmıyor');
  if (!result.seal || !result.bodyHex) {
    return fail('uyuşmazlıkta imzalama ATLANDI — enclave karar veriyor, oysa sadece raporlamalı');
  }

  const decoded = decodeBody(result.bodyHex);
  if (decoded.match !== false) return fail('gövdedeki match alanı false değil');

  const expected = new ethers.Wallet(enclaveKeys.binding).address;
  const signer = recoverBindingSigner(result.bodyHex, result.seal, expected);
  if (signer.toLowerCase() !== expected.toLowerCase()) return fail('uyuşmazlık gövdesi farklı anahtarla imzalanmış');

  return pass(
    [
      'match=false ama gövde YİNE imzalandı',
      'enclave reddetmiyor, RAPORLUYOR — reddi kontrat yapıyor (fraud demosu buna dayanıyor)',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 3. Gövde geri çözülüyor
// ---------------------------------------------------------------------------
gate.check('Gövde abi.decode ile geri çözülüyor ve alanlar birebir eşleşiyor', async () => {
  const { intentHash, request } = await buildEnvelope();
  const result = await runBinding(request, enclaveKeys, {
    compute: createFixtureComputeBackend({ dir: OG_DIR }),
  });
  if (!result.bodyHex) return fail('gövde yok');

  const decoded = decodeBody(result.bodyHex);
  if (decoded.intentHash.toLowerCase() !== intentHash.toLowerCase()) {
    return fail(`gövdedeki intentHash ${decoded.intentHash} ≠ ${intentHash}`);
  }
  if (decoded.match !== true) return fail('gövdedeki match true değil');
  // Gövdedeki outputHash, binding'in raporladığı ile birebir aynı olmalı.
  if (decoded.outputHash.toLowerCase() !== result.outputHash.toLowerCase()) {
    return fail(`gövdedeki outputHash ${decoded.outputHash} ≠ raporlanan ${result.outputHash}`);
  }
  if (!/^0x[0-9a-f]{64}$/i.test(decoded.outputHash)) return fail(`outputHash bozuk: ${decoded.outputHash}`);
  if (!/^0x[0-9a-f]{64}$/i.test(decoded.ogSigHash)) return fail(`ogSigHash bozuk: ${decoded.ogSigHash}`);

  // Gövde 4 × 32 bayt olmalı: kontrat alanları YENİDEN KURUYOR, JSON ayrıştırmıyor.
  const expectedBytes = 4 * 32;
  const actualBytes = (result.bodyHex.length - 2) / 2;
  if (actualBytes !== expectedBytes) {
    return fail(`gövde ${actualBytes} bayt, beklenen ${expectedBytes} (abi.encode 4 alan)`);
  }

  return pass(
    [
      `intentHash ✓ · match ✓ · outputHash ${decoded.outputHash.slice(0, 12)}… · ogSigHash ${decoded.ogSigHash.slice(0, 12)}…`,
      `${actualBytes} bayt = 4 × 32 — kontrat alanları yeniden kurabiliyor`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 4. Replay modu — faucet yakmadan iterasyon
// ---------------------------------------------------------------------------
gate.check('REPLAY_0G=1 ile binding çalışıyor ve kendini doğru etiketliyor', async () => {
  const { backend, reason } = await selectComputeBackend(
    { REPLAY_0G: '1', OG_RPC_URL: cfg.OG_RPC_URL, OG_PRIVATE_KEY: process.env.OG_PRIVATE_KEY },
    { fixtureDir: OG_DIR },
  );
  if (backend.provider !== 'fixture-replay') {
    return fail(`REPLAY_0G=1 iken sağlayıcı "${backend.provider}" seçildi — ${reason}`);
  }

  const { request } = await buildEnvelope();
  const result = await runBinding(request, enclaveKeys, { compute: backend });

  if (result.computeProvider !== 'fixture-replay') {
    return fail(`sonuç "${result.computeProvider}" diyor — replay kendini canlı gösteriyor`);
  }
  if (!result.match) return fail('replay modunda match=false');
  if (!result.ogVerified) return fail('kayıtlı imza replay sırasında doğrulanamadı');

  // Eski isim de çalışmalı ki plandaki/.env'deki kullanım kırılmasın.
  const legacy = await selectComputeBackend({ MOCK_0G: '1' }, { fixtureDir: OG_DIR });
  if (legacy.backend.provider !== 'fixture-replay') return fail('eski MOCK_0G adı artık çalışmıyor');

  return pass(
    [
      'REPLAY_0G=1 → fixture-replay, binding tam akışı koştu',
      'etiket sonuca kadar taşındı: computeProvider=fixture-replay',
      'eski MOCK_0G adı da kabul ediliyor',
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 5. Ağ çıkışı SADECE 0G
// ---------------------------------------------------------------------------
gate.check('Enclave\'in canlı koşuda ağ çıkışı yalnızca 0G adresleri', async () => {
  const hosts = new Set<string>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      hosts.add(new URL(String(input instanceof Request ? input.url : input)).host);
    } catch {
      hosts.add(String(input).slice(0, 40));
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;

  try {
    const { request } = await buildEnvelope();
    const started = Date.now();
    await runBinding(request, enclaveKeys, { compute: await liveBackend() });
    latencies.push(Date.now() - started);
  } finally {
    globalThis.fetch = realFetch;
  }

  // 0G RPC'si + sağlayıcının endpoint'i dışında bir host görünmemeli.
  const allowed = new Set<string>([new URL(cfg.OG_RPC_URL).host]);
  const signerFixture = JSON.parse(
    await import('node:fs').then((fs) => fs.readFileSync(resolve(OG_DIR, 'signer.json'), 'utf8')),
  ) as { url: string };
  allowed.add(new URL(signerFixture.url).host);

  const strangers = [...hosts].filter((h) => !allowed.has(h));
  if (strangers.length > 0) {
    return fail(
      `0G dışı ağ çıkışı: ${strangers.join(', ')}\n` +
        'imageHash ile ölçülen kodun başka yere konuşmaması gerekiyor',
    );
  }
  return pass(`çıkılan hostlar: ${[...hosts].join(', ') || '(yok)'} — hepsi 0G`);
});

// ---------------------------------------------------------------------------
// 6. p95 gecikme
// ---------------------------------------------------------------------------
gate.check(`Canlı binding p95 < ${P95_BUDGET_MS / 1000} sn`, async () => {
  const backend = await liveBackend();
  while (latencies.length < LATENCY_SAMPLES) {
    const { request } = await buildEnvelope();
    const started = Date.now();
    await runBinding(request, enclaveKeys, { compute: backend });
    latencies.push(Date.now() - started);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  // p95: küçük örneklemde bu pratikte en yavaş koşu. Böyle olması iyi — iyimser taraf değil.
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];

  if (p95 >= P95_BUDGET_MS) {
    return fail(`p95 ${p95} ms — bütçe ${P95_BUDGET_MS} ms. Model küçültülmeli ya da maxTokens düşürülmeli.`);
  }
  return pass(
    [
      `${sorted.length} örnek: ${sorted.join(', ')} ms`,
      `p95 = ${p95} ms · 60 sn uçtan uca bütçenin %${((p95 / P95_BUDGET_MS) * 100).toFixed(1)}'i`,
    ].join('\n'),
  );
});

await gate.run();
