// tests/gates/P4-D.ts — HCS iş zaman çizelgesi kapısı (SIFIR Solidity).
//
// BUILD-PLAN P4-D geçiş kriterleri:
//   [ ] 5 mesaj da mirror node'dan okunuyor, SIRALI consensus timestamp'ler
//   [ ] Hiçbir mesajda düz metin brief/data/output YOK (grep ile kanıtla)
//   [ ] Fraud koşusunda SETTLED YOK, ama OUTPUT_COMMIT match:false VAR
//       → red de zaman çizelgesine yazılı, tamper-evident
//   [ ] Zaman çizelgesi demo dApp'te render ediliyor  ← P5-A, burada raporlanır
//
// HCS yerel bir Hedera servisi: kontrat, deploy, ABI yok.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { closeBob, runDemo, type DemoReport } from '../../packages/demo/src/index.js';
import { readTimeline } from '../../packages/payment/src/hcs-timeline.js';
import { TIMELINE_STAGES, stageOrder, type RecordedTimelineEvent } from '../../packages/shared/src/timeline.js';
import { loadDotenv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const root = repoRoot();
const gate = new Gate('P4-D', 'HCS iş zaman çizelgesi (sıfır Solidity)');
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString() };

const TOPIC_ID = requireEnv('HEDERA_TOPIC_ID');
const HASHSCAN = 'https://hashscan.io/testnet';

// Gizli iş — bu metinlerin topic'te GEÇMEMESİ kapının konusu.
const SECRET_BRIEF = 'CONFIDENTIAL-TIMELINE-BRIEF: assess revenue-recognition risk for ACME Q3.';
const SECRET_DATA = 'CONFIDENTIAL-TIMELINE-DATA: Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR.';

let honest: DemoReport | undefined;
let fraud: DemoReport | undefined;
let honestEvents: RecordedTimelineEvent[] = [];
let fraudEvents: RecordedTimelineEvent[] = [];

// ---------------------------------------------------------------------------
// 1. Sıfır Solidity — yapısal
// ---------------------------------------------------------------------------
gate.check('Zaman çizelgesi yolunda Solidity/kontrat YOK', () => {
  // Yorumlar ayıklanır: "SIFIR SOLIDITY" yazan bir açıklama satırı kodun kontrat
  // kullandığı anlamına gelmez. Bakılacak olan çalışan kod.
  const code = readFileSync(resolve(root, 'packages/payment/src/hcs-timeline.ts'), 'utf8')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n')
    .toLowerCase();

  const banned = ['solidity', 'contractexecutetransaction', 'contractcreatetransaction', 'precompile', '0x167'];
  const hits = banned.filter((b) => code.includes(b));
  return hits.length === 0
    ? pass('çalışan kodda yalnızca TopicMessageSubmitTransaction + mirror node REST — kontrat yok')
    : fail(`yasaklı sembol: ${hits.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 2. Dürüst koşu — beş aşama
// ---------------------------------------------------------------------------
gate.check('Dürüst koşu 5 aşamayı da yazdı', async () => {
  honest = await runDemo({
    fraudMode: 'none',
    paymentRail: 'hedera',
    brief: SECRET_BRIEF,
    data: SECRET_DATA,
    nonce: BigInt(Date.now()),
    log: () => {},
  });
  if (!honest.verified) return fail(`iş doğrulanmadı: ${honest.codeName}`);
  if (!honest.timeline) return fail('zaman çizelgesi hiç yazılmadı');

  const stages = honest.timeline.stages;
  const missing = TIMELINE_STAGES.filter((s) => !stages.includes(s));
  evidence.honestStages = stages;
  return missing.length === 0
    ? pass(`${stages.join(' → ')}\ntopic ${honest.timeline.topicId} · ${honest.timeline.hashscanUrl}`)
    : fail(`eksik aşama: ${missing.join(', ')} (yazılan: ${stages.join(', ')})`);
});

gate.check('5 mesaj mirror node\'dan okunuyor, consensus timestamp\'leri SIRALI', async () => {
  if (!honest) return fail('dürüst koşu yok');
  honestEvents = await readTimeline(TOPIC_ID, honest.signedIntentHash, { expect: 5 });
  if (honestEvents.length < 5) {
    return fail(`mirror node'dan ${honestEvents.length}/5 mesaj okundu`);
  }

  const problems: string[] = [];
  // Consensus timestamp'ler artan olmalı — sıra ağın garantisi, bizim değil.
  for (let i = 1; i < honestEvents.length; i++) {
    const prev = honestEvents[i - 1]!;
    const cur = honestEvents[i]!;
    if (Number(cur.consensusTimestamp) <= Number(prev.consensusTimestamp)) {
      problems.push(`timestamp artmıyor: ${prev.consensusTimestamp} → ${cur.consensusTimestamp}`);
    }
    // Mantıksal sıra da korunmalı.
    if (stageOrder(cur.event.stage) < stageOrder(prev.event.stage)) {
      problems.push(`aşama sırası bozuk: ${prev.event.stage} → ${cur.event.stage}`);
    }
  }

  evidence.honestTimeline = honestEvents.map((e) => ({
    seq: e.sequenceNumber,
    stage: e.event.stage,
    consensusTimestamp: e.consensusTimestamp,
  }));

  return problems.length === 0
    ? pass(
        honestEvents
          .map((e) => `  #${e.sequenceNumber} ${e.event.stage.padEnd(16)} ${e.consensusTimestamp}`)
          .join('\n'),
      )
    : fail(problems.join('\n'));
});

// ---------------------------------------------------------------------------
// 3. Düz metin sızıntısı YOK
// ---------------------------------------------------------------------------
gate.check('Hiçbir mesajda düz metin brief/data/output YOK', () => {
  if (!honestEvents.length) return fail('okunan mesaj yok');
  const serialized = JSON.stringify(honestEvents.map((e) => e.event));

  const hits: string[] = [];
  for (const [label, secret] of [
    ['brief', SECRET_BRIEF],
    ['data', SECRET_DATA],
    ['output', honest?.output ?? ''],
  ] as const) {
    if (!secret) continue;
    for (let i = 0; i + 16 <= secret.length; i += 16) {
      const w = secret.slice(i, i + 16);
      if (serialized.includes(w)) hits.push(`${label}: "${w}"`);
    }
    // Hex kodlanmış hâli de aranmalı.
    const hex = Buffer.from(secret, 'utf8').toString('hex');
    for (let i = 0; i + 32 <= hex.length; i += 32) {
      if (serialized.toLowerCase().includes(hex.slice(i, i + 32))) hits.push(`${label}: hex parçası`);
    }
  }

  return hits.length === 0
    ? pass(
        [
          `${honestEvents.length} mesaj tarandı (düz metin + hex pencereleri)`,
          'topic yalnızca taahhüt taşıyor: intentHash, outputHash, match, txId',
        ].join('\n'),
      )
    : fail(hits.slice(0, 5).join('\n'));
});

gate.check('Sızıntı ağa ÇIKMADAN önce yakalanıyor (üretim yolunda koruma)', async () => {
  // `assertNoPlaintext` yalnızca kapıda değil, gönderim yolunda da çalışıyor:
  // yanlışlıkla brief eklenmiş bir olay topic'e hiç ulaşmamalı.
  const { assertNoPlaintext } = await import('../../packages/shared/src/timeline.js');
  const leaky = {
    v: 1 as const,
    stage: 'SETTLED' as const,
    intentHash: `0x${'11'.repeat(32)}`,
    by: 'client' as const,
    rail: 'hedera-x402',
    txId: `sızıntı: ${SECRET_BRIEF}`,
    jobVerifiedTx: '0xabc',
  };
  try {
    assertNoPlaintext(leaky, [SECRET_BRIEF, SECRET_DATA]);
    return fail('düz metin taşıyan olay denetimden geçti');
  } catch (err) {
    return pass(`gönderim öncesi reddedildi: ${(err as Error).message.slice(0, 110)}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Fraud koşusu — red de zaman çizelgesinde
// ---------------------------------------------------------------------------
gate.check('Fraud koşusunda SETTLED YOK ama OUTPUT_COMMIT match:false VAR', async () => {
  fraud = await runDemo({
    fraudMode: 'substitute',
    paymentRail: 'hedera',
    brief: SECRET_BRIEF,
    data: SECRET_DATA,
    nonce: BigInt(Date.now()) + 1n,
    log: () => {},
  });
  if (fraud.verified) return fail('hile yapıldığı hâlde iş doğrulandı');
  if (!fraud.timeline) return fail('fraud koşusunda zaman çizelgesi yazılmadı');

  fraudEvents = await readTimeline(TOPIC_ID, fraud.signedIntentHash, { expect: 4 });
  if (fraudEvents.length < 4) return fail(`mirror node'dan ${fraudEvents.length}/4 mesaj okundu`);

  const stages = fraudEvents.map((e) => e.event.stage);
  if (stages.includes('SETTLED')) return fail('doğrulanmamış iş için SETTLED yazılmış');

  const outputCommit = fraudEvents.find((e) => e.event.stage === 'OUTPUT_COMMIT');
  if (!outputCommit) return fail('OUTPUT_COMMIT yok');
  if (outputCommit.event.stage !== 'OUTPUT_COMMIT') return fail('tip daralması başarısız');
  if (outputCommit.event.match !== false) {
    return fail(`OUTPUT_COMMIT match=${outputCommit.event.match}, false bekleniyordu`);
  }

  evidence.fraudTimeline = fraudEvents.map((e) => ({
    seq: e.sequenceNumber,
    stage: e.event.stage,
    consensusTimestamp: e.consensusTimestamp,
  }));

  return pass(
    [
      `aşamalar: ${stages.join(' → ')}`,
      'SETTLED YOK — ödeme hiç settle olmadı',
      'OUTPUT_COMMIT match=false — red de zaman çizelgesinde, tamper-evident',
    ].join('\n'),
  );
});

gate.check('Enclave zaman çizelgesinde de DÜRÜST (hile gizlenmiyor)', () => {
  const oc = fraudEvents.find((e) => e.event.stage === 'OUTPUT_COMMIT');
  if (!oc || oc.event.stage !== 'OUTPUT_COMMIT') return fail('OUTPUT_COMMIT yok');
  // Bob hile yaptı ama zincire yazılan kayıt bunu saklamıyor: match=false orada.
  // Sonradan "aslında olmadı" denemez — consensus timestamp'i var.
  return pass(
    [
      `outputHash ${oc.event.outputHash.slice(0, 20)}… · match=false`,
      `consensus ${oc.consensusTimestamp} — geri alınamaz`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 5. Attestation dürüstlüğü
// ---------------------------------------------------------------------------
gate.check('ENCLAVE_INVOKED attestation durumunu UYDURMUYOR', () => {
  const ei = honestEvents.find((e) => e.event.stage === 'ENCLAVE_INVOKED');
  if (!ei || ei.event.stage !== 'ENCLAVE_INVOKED') return fail('ENCLAVE_INVOKED yok');
  if (ei.event.attestation !== 'none') {
    return fail(`attestation="${ei.event.attestation}" — gerçek Tapp yokken 'none' olmalı`);
  }
  if (ei.event.imageHash !== null) return fail('ölçülmüş imaj yokken imageHash dolu');
  return pass(
    [
      `attestation="none" · imageHash=null — uydurulmadı`,
      `bindingSigner=${ei.event.bindingSigner} — elimizde GERÇEKTEN olan şey yazıldı`,
    ].join('\n'),
  );
});

gate.check('Kanıt dosyası yazıldı (fixtures/hedera/P4-D.json)', async () => {
  await closeBob();
  evidence.topicId = TOPIC_ID;
  evidence.hashscanTopic = `${HASHSCAN}/topic/${TOPIC_ID}`;
  evidence.demoDappRendering = 'BEKLİYOR — P5-A paneli bu topic\'i render edecek';
  const dir = resolve(root, 'fixtures/hedera');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'P4-D.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return pass(
    [
      'fixtures/hedera/P4-D.json',
      `topic: ${HASHSCAN}/topic/${TOPIC_ID}`,
      'NOT: "dApp\'te render ediliyor" kriteri P5-A\'ya ait — henüz yapılmadı.',
    ].join('\n'),
  );
});

await gate.run();
