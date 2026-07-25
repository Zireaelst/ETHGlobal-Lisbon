// tests/gates/P0-E.ts — Hedera x402 uçtan uca + HCS timeline kapısı.
//
// BUILD-PLAN P0-E geçiş kriterleri:
//   [ ] HashScan'de görünen, BAŞARILI transfer transaction'ı (link kaydedildi)
//   [ ] Ödeyen gas'ı FACILITATOR (feePayer alanı 0.0.7162784)
//   [ ] HCS topic'e yazılan mesaj mirror node'dan okunabiliyor, consensus timestamp'i var
//   [ ] Uçtan uca süre < 10 sn
//
// Kapı GERÇEK testnet'e çıkar — mock yok. Ürettiği kanıtlar fixtures/hedera/P0-E.json'a yazılır
// (HashScan linkleri submission README'sine girecek).

import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { x402ResourceServer } from '@x402/core/server';
import { x402Client } from '@x402/core/client';
import {
  HTTPFacilitatorClient,
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { ExactHederaScheme as ExactHederaClientScheme } from '@x402/hedera/exact/client';
import { ExactHederaScheme as ExactHederaServerScheme } from '@x402/hedera/exact/server';
import { createClientHederaSigner } from '@x402/hedera';
import {
  AccountCreateTransaction,
  Client,
  Hbar,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk';

import { loadConfig, loadDotenv, optionalEnv, repoRoot } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';
import { setEnvValue } from './_env-write.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const NETWORK = 'hedera:testnet' as const;
const MIRROR = 'https://testnet.mirrornode.hedera.com';
const HASHSCAN = 'https://hashscan.io/testnet';
const PRICE_TINYBARS = '1000000'; // 0.01 HBAR
const RESOURCE_PATH = '/paid-resource';
const SELLER_CACHE = resolve(root, 'scripts/spikes/.hedera-x402-seller.json');
const LATENCY_BUDGET_MS = 10_000;

const gate = new Gate('P0-E', 'Hedera x402 uçtan uca + HCS timeline');

/** Kanıt dosyası — HashScan linkleri submission'a girecek. */
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString(), network: NETWORK };

function hederaClient(): Client {
  return Client.forTestnet().setOperator(
    cfg.HEDERA_OPERATOR_ID,
    PrivateKey.fromStringECDSA(cfg.HEDERA_OPERATOR_KEY),
  );
}

/** Mirror node indekslemesi anlık değil — kısa aralıklarla yokla. */
async function pollMirror<T>(
  path: string,
  accept: (body: T) => boolean,
  { tries = 15, delayMs = 1000 } = {},
): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MIRROR}${path}`);
    if (res.ok) {
      const body = (await res.json()) as T;
      if (accept(body)) return body;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Facilitator ayakta ve hedera:testnet exact şemasını destekliyor
// ---------------------------------------------------------------------------
let resourceServer: x402ResourceServer | undefined;

gate.check(`Facilitator ayakta ve ${NETWORK} exact şemasını destekliyor`, async () => {
  const facilitator = new HTTPFacilitatorClient({ url: cfg.BLOCKY402_URL });
  resourceServer = new x402ResourceServer(facilitator);
  resourceServer.register(NETWORK, new ExactHederaServerScheme());
  await resourceServer.initialize();
  evidence.facilitatorUrl = cfg.BLOCKY402_URL;
  return pass(`${cfg.BLOCKY402_URL} (API key yok)`);
});

// ---------------------------------------------------------------------------
// 2. Alıcı hesap — payer == payTo self-pay'i facilitator reddediyor, ayrı hesap şart
// ---------------------------------------------------------------------------
let sellerAccountId = '';

gate.check('Alıcı (seller) hesabı hazır', async () => {
  if (existsSync(SELLER_CACHE)) {
    const cached = JSON.parse(readFileSync(SELLER_CACHE, 'utf8')) as { accountId: string };
    sellerAccountId = cached.accountId;
    return pass(`önbellekten: ${sellerAccountId}`);
  }
  const client = hederaClient();
  try {
    const sellerKey = PrivateKey.generateECDSA();
    const receipt = await (
      await new AccountCreateTransaction()
        .setKeyWithoutAlias(sellerKey.publicKey)
        .setInitialBalance(new Hbar(2))
        .execute(client)
    ).getReceipt(client);
    const accountId = receipt.accountId?.toString();
    if (!accountId) return fail('AccountCreateTransaction accountId döndürmedi');
    sellerAccountId = accountId;
    writeFileSync(SELLER_CACHE, JSON.stringify({ accountId, privateKey: sellerKey.toStringRaw() }, null, 2));
    return pass(`yeni hesap oluşturuldu (2 ℏ): ${accountId}`);
  } finally {
    client.close();
  }
});

// ---------------------------------------------------------------------------
// 3. 402 -> pay -> 200 round trip (gerçek testnet, gerçek facilitator)
// ---------------------------------------------------------------------------
let settledTxId = '';
let roundTripMs = 0;
let server: Server | undefined;

gate.check('402 → pay → 200 round trip başarılı', async () => {
  if (!resourceServer) return fail('resourceServer kurulamadı');

  const requirements = await resourceServer.buildPaymentRequirements({
    scheme: 'exact',
    payTo: sellerAccountId,
    price: { asset: '0.0.0', amount: PRICE_TINYBARS },
    network: NETWORK,
    maxTimeoutSeconds: 60,
  });

  const rs = resourceServer;
  let settlement: { success?: boolean; transaction?: string; errorReason?: string } | undefined;
  let serverError: string | undefined;

  server = createServer((req, res) => {
    void (async () => {
      const resourceInfo = {
        url: `http://localhost${RESOURCE_PATH}`,
        description: 'P0-E gate resource',
        mimeType: 'application/json',
      };
      const header = req.headers['payment-signature'];
      if (!header) {
        const required = await rs.createPaymentRequiredResponse(requirements, resourceInfo);
        res.writeHead(402, {
          'Content-Type': 'application/json',
          'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required),
        });
        res.end(JSON.stringify(required));
        return;
      }
      try {
        const payload = decodePaymentSignatureHeader(String(header));
        const matched = rs.findMatchingRequirements(requirements, payload);
        if (!matched) throw new Error('eşleşen payment requirement yok');
        const verified = await rs.verifyPayment(payload, matched);
        if (!verified.isValid) throw new Error(`verify reddetti: ${verified.invalidReason}`);
        settlement = await rs.settlePayment(payload, matched);
        if (!settlement?.success) throw new Error(`settle başarısız: ${settlement?.errorReason}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, settlement }));
      } catch (err) {
        serverError = err instanceof Error ? err.message : String(err);
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: serverError }));
      }
    })();
  });

  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}${RESOURCE_PATH}`;

  // Ölçüm buradan başlar: istemcinin ilk isteğinden 200'e kadar geçen TÜM süre.
  const started = Date.now();

  const res1 = await fetch(url);
  if (res1.status !== 402) return fail(`ilk istek 402 değil, ${res1.status} döndü`);
  const requiredHeader = res1.headers.get('payment-required');
  if (!requiredHeader) return fail('402 yanıtında PAYMENT-REQUIRED header yok');

  const signer = createClientHederaSigner(
    cfg.HEDERA_OPERATOR_ID,
    PrivateKey.fromStringECDSA(cfg.HEDERA_OPERATOR_KEY),
    { network: NETWORK },
  );
  const client = new x402Client().register('hedera:*', new ExactHederaClientScheme(signer));
  const payload = await client.createPaymentPayload(decodePaymentRequiredHeader(requiredHeader));

  const res2 = await fetch(url, {
    headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) },
  });
  roundTripMs = Date.now() - started;

  if (res2.status !== 200) {
    const body = await res2.text().catch(() => '');
    return fail(`ödeme sonrası 200 değil, ${res2.status}: ${serverError ?? body}`);
  }
  if (!settlement?.transaction) return fail('settlement transaction id döndürmedi');

  settledTxId = settlement.transaction;
  evidence.payer = cfg.HEDERA_OPERATOR_ID;
  evidence.payTo = sellerAccountId;
  evidence.priceTinybars = PRICE_TINYBARS;
  evidence.settledTxId = settledTxId;
  evidence.roundTripMs = roundTripMs;
  return pass(`402 → ödeme → 200 · tx ${settledTxId} · ${roundTripMs} ms`);
});

gate.check(`Uçtan uca süre < ${LATENCY_BUDGET_MS / 1000} sn`, () => {
  if (!roundTripMs) return fail('süre ölçülemedi');
  return roundTripMs < LATENCY_BUDGET_MS
    ? pass(`${roundTripMs} ms (bütçe ${LATENCY_BUDGET_MS} ms)`)
    : fail(`${roundTripMs} ms — bütçe ${LATENCY_BUDGET_MS} ms aşıldı`);
});

// ---------------------------------------------------------------------------
// 4. Mirror node: transfer GERÇEKTEN başarılı + gas'ı facilitator ödedi
// ---------------------------------------------------------------------------
type MirrorTx = {
  transactions?: Array<{
    result?: string;
    transaction_id?: string;
    charged_tx_fee?: number;
    transfers?: Array<{ account?: string; amount?: number }>;
  }>;
};

gate.check('Mirror node transferi SUCCESS olarak gösteriyor (HashScan linki)', async () => {
  if (!settledTxId) return fail('settle tx id yok');
  // "0.0.7162784@1784936701.955111199" -> "0.0.7162784-1784936701-955111199"
  const [account, stamp] = settledTxId.split('@');
  if (!account || !stamp) return fail(`beklenmedik tx id biçimi: ${settledTxId}`);
  const mirrorId = `${account}-${stamp.replace('.', '-')}`;

  const body = await pollMirror<MirrorTx>(
    `/api/v1/transactions/${mirrorId}`,
    (b) => Boolean(b.transactions?.length),
  );
  const tx = body?.transactions?.[0];
  if (!tx) return fail(`mirror node ${mirrorId} işlemini indekslemedi (15 sn beklendi)`);

  const link = `${HASHSCAN}/transaction/${mirrorId}`;
  evidence.hashscanTransfer = link;
  evidence.mirrorTransaction = tx;

  return tx.result === 'SUCCESS'
    ? pass(`result=SUCCESS\n${link}`)
    : fail(`result=${tx.result}\n${link}`);
});

gate.check(`Gas'ı facilitator ödüyor (feePayer == ${cfg.BLOCKY402_FEE_PAYER})`, () => {
  if (!settledTxId) return fail('settle tx id yok');
  // Hedera'da işlem ücretini transaction id'nin sahibi öder. Payer == facilitator ise
  // Alice gas ödemiyor demektir — x402'nin bize sattığı asıl özellik bu.
  const payer = settledTxId.split('@')[0];
  const tx = (evidence.mirrorTransaction ?? {}) as { charged_tx_fee?: number; transfers?: Array<{ account?: string; amount?: number }> };
  const feePayerDebit = tx.transfers?.find((t) => t.account === cfg.BLOCKY402_FEE_PAYER)?.amount;

  if (payer !== cfg.BLOCKY402_FEE_PAYER) {
    return fail(`tx payer = ${payer}, beklenen ${cfg.BLOCKY402_FEE_PAYER}\n→ gas'ı biz ödemişiz, facilitator devrede değil`);
  }
  evidence.feePayer = payer;
  evidence.chargedTxFeeTinybars = tx.charged_tx_fee;
  const detail = [
    `tx payer = ${payer} (facilitator)`,
    `ücret = ${tx.charged_tx_fee ?? '?'} tinybar`,
    feePayerDebit !== undefined ? `facilitator hesabı ${feePayerDebit} tinybar değişti` : '',
    `ödeyen (Alice) = ${cfg.HEDERA_OPERATOR_ID} — gas ödemedi`,
  ].filter(Boolean);
  return pass(detail.join('\n'));
});

gate.check('Doğru miktar doğru hesaba taşındı (ücretten ayrı)', () => {
  const tx = (evidence.mirrorTransaction ?? {}) as {
    transfers?: Array<{ account?: string; amount?: number }>;
  };
  const transfers = tx.transfers;
  if (!transfers?.length) return fail('mirror node transfer listesi boş');

  const price = Number(PRICE_TINYBARS);
  const debit = transfers.find((t) => t.account === cfg.HEDERA_OPERATOR_ID)?.amount;
  const credit = transfers.find((t) => t.account === sellerAccountId)?.amount;

  const problems: string[] = [];
  // Ödeyen TAM fiyat kadar borçlanmalı — bir tinybar fazlası ücretin ona yıkıldığı anlamına gelir.
  if (debit !== -price) problems.push(`ödeyen ${cfg.HEDERA_OPERATOR_ID}: ${debit ?? 'yok'} (beklenen ${-price})`);
  if (credit !== price) problems.push(`alıcı ${sellerAccountId}: ${credit ?? 'yok'} (beklenen ${price})`);

  return problems.length === 0
    ? pass(`${cfg.HEDERA_OPERATOR_ID} ${-price} → ${sellerAccountId} +${price} tinybar · ücret ödeyene yıkılmadı`)
    : fail(problems.join('\n'));
});

// ---------------------------------------------------------------------------
// 5. HCS topic — P4-D iş zaman çizelgesinin taşıyıcısı
// ---------------------------------------------------------------------------
let topicId = '';

gate.check('HCS topic mevcut (yoksa oluşturulup .env\'e yazılır)', async () => {
  const existing = optionalEnv('HEDERA_TOPIC_ID');
  if (existing) {
    topicId = existing;
    return pass(`.env'den: ${topicId}`);
  }
  const client = hederaClient();
  try {
    const receipt = await (
      await new TopicCreateTransaction()
        .setTopicMemo('confidential-agents · job timeline (commitments only)')
        .execute(client)
    ).getReceipt(client);
    const created = receipt.topicId?.toString();
    if (!created) return fail('TopicCreateTransaction topicId döndürmedi');
    topicId = created;
    setEnvValue('HEDERA_TOPIC_ID', topicId);
    return pass(`oluşturuldu ve .env'e yazıldı: ${topicId}`);
  } finally {
    client.close();
  }
});

let submittedMessage = '';
let submittedSeq = 0n;

gate.check('Topic\'e mesaj yazıldı', async () => {
  if (!topicId) return fail('topic id yok');
  // İçerik değil TAAHHÜT gönderiyoruz — P4-D kuralı: topic'e düz metin brief/data/output girmez.
  submittedMessage = JSON.stringify({ t: 'GATE_P0E', intentHash: `0x${'00'.repeat(32)}`, at: Date.now() });
  const client = hederaClient();
  try {
    const receipt = await (
      await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(submittedMessage)
        .execute(client)
    ).getReceipt(client);
    submittedSeq = BigInt(receipt.topicSequenceNumber?.toString() ?? '0');
    evidence.topicId = topicId;
    evidence.topicSequenceNumber = submittedSeq.toString();
    evidence.hashscanTopic = `${HASHSCAN}/topic/${topicId}`;
    return pass(`sequence #${submittedSeq} · ${HASHSCAN}/topic/${topicId}`);
  } finally {
    client.close();
  }
});

type MirrorMessages = {
  messages?: Array<{ consensus_timestamp?: string; message?: string; sequence_number?: number }>;
};

gate.check('Mesaj mirror node\'dan okunuyor ve consensus timestamp\'i var', async () => {
  if (!topicId || !submittedSeq) return fail('topic mesajı gönderilemedi');

  const body = await pollMirror<MirrorMessages>(
    `/api/v1/topics/${topicId}/messages?limit=25&order=desc`,
    (b) => Boolean(b.messages?.some((m) => BigInt(m.sequence_number ?? 0) === submittedSeq)),
  );
  const msg = body?.messages?.find((m) => BigInt(m.sequence_number ?? 0) === submittedSeq);
  if (!msg) return fail(`mirror node #${submittedSeq} mesajını indekslemedi (15 sn beklendi)`);

  if (!msg.consensus_timestamp) return fail('mesajda consensus_timestamp yok');

  // Mirror node mesajı base64 döndürür — gönderdiğimiz byte'larla birebir aynı mı?
  const decoded = Buffer.from(msg.message ?? '', 'base64').toString('utf8');
  if (decoded !== submittedMessage) {
    return fail(`okunan mesaj gönderilenle aynı değil:\n  gönderilen: ${submittedMessage}\n  okunan:     ${decoded}`);
  }

  evidence.topicConsensusTimestamp = msg.consensus_timestamp;
  return pass(
    `#${submittedSeq} · consensus_timestamp=${msg.consensus_timestamp}\nokunan mesaj gönderilenle byte-identik`,
  );
});

// ---------------------------------------------------------------------------
// 6. Kanıt dosyası
// ---------------------------------------------------------------------------
gate.check('Kanıt dosyası yazıldı (fixtures/hedera/P0-E.json)', () => {
  server?.close();
  const dir = resolve(root, 'fixtures/hedera');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'P0-E.json');
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return pass(
    [
      'fixtures/hedera/P0-E.json',
      `transfer: ${evidence.hashscanTransfer ?? '-'}`,
      `topic:    ${evidence.hashscanTopic ?? '-'}`,
    ].join('\n'),
  );
});

await gate.run();
