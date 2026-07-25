// bob-agent — Bob'un DIŞ katmanı (BUILD-PLAN §2.1).
//
// Bu süreç enclave DEĞİL. Enclave (`@ca/bob-binding`) `imageHash` ile ölçülüyor ve
// minimal tutuluyor; HTTP sunucusu, ödeme, loglama ve (P1-D'de gelecek) FRAUD_MODE
// burada, dışarıda kalır. Tezin özü bu ayrım: enclave içindeki kod hep dürüst,
// hile yapabilen taraf bu katman.
//
// FAZ 1 kapsamı: Bob ECHO yapıyor — paketi çözer, intentHash'i yeniden hesaplar,
// eşleşmeyi raporlar. 0G çağrısı ve seal imzası YOK (onlar P3-B).
//
// Uçlar:
//   GET  /.well-known/agent-card.json   — keşif kartı
//   POST /task                          — { to, cipher }
//   GET  /result/:intentHash            — { cipher }  (Alice'in replyPubKey'ine şifreli)
//   GET  /health

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

import {
  AgentCardSchema,
  PLACEHOLDER_VERIFIER,
  TaskEnvelopeSchema,
  TaskRequestSchema,
  type AgentCard,
  type ComputeBackend,
  type Constraints,
  type EchoResult,
  createNoComputeBackend,
  decryptWith,
  eciesPublicKeyOf,
  encryptFor,
  parseOrThrow,
  recoverIntentSigner,
} from '@ca/shared';
import { recoverBindingSigner, runBinding } from '@ca/bob-binding';
import {
  applyPostBindingFraud,
  applyPreBindingFraud,
  isFraudMode,
  type FraudMode,
} from './fraud.js';

export interface BobAgentOptions {
  /** Bob'un ECIES private key'i (BOB_ECIES_PRIV). */
  eciesPrivateKey: string;
  /** ERC-8004 agentId, decimal string. */
  agentId: string;
  /** Bob'un cüzdan adresi (kayıt sahibi). */
  owner: string;
  skills: string[];
  price: { amount: string; asset: string; decimals: number };
  /** Bob'un Hedera ödeme hesabı — kartta duyurulur, ödeme rayı bunu kullanır. */
  hederaAccount?: string;
  /** EIP-712 domain'inin verifyingContract'ı — Alice'in imzasını doğrulamak için. */
  verifyingContract: string;
  /**
   * Binding (FAZ 1'de yerel, P3'te enclave seal) imza anahtarı.
   *
   * Bu anahtar bob-agent'ta DEĞİL, enclave'de yaşamalı — FAZ 1'de enclave bir
   * fonksiyon çağrısı olduğu için buradan geçiriliyor. P3-B'de Tapp'e taşınacak
   * ve bob-agent onu bir daha görmeyecek.
   */
  bindingKey: string;
  chainId?: number;
  port?: number;
  /** Başlangıç hile modu. Çalışırken `setFraudMode` ile değişebilir. */
  fraudMode?: FraudMode;
  /**
   * Seal preimage'ının ilk alanı — wrapper'ın kendi agent kimliği.
   * ERC-8004 `agentId`'sinden FARKLI olabilir; gerçek Tapp'te wrapper belirler.
   */
  sealAgentId?: string;
  /**
   * Modelin nerede koşacağı. Verilmezse `none` — gerçek çıkarım ve TEE imzası YOK.
   * 0G token'ı geldiğinde burası `createZeroGBackend(...)` olacak; başka hiçbir yer
   * değişmeyecek (compute.ts sınırının varlık sebebi bu).
   */
  compute?: ComputeBackend;
  /** Kartın `endpoint` alanı; verilmezse dinlenen adresten türetilir. */
  publicUrl?: string;
  log?: (line: string) => void;
  /**
   * Test kancası: Bob'un ÇÖZDÜĞÜ düz metin paketi.
   *
   * Kapı testi "Bob düz metni doğru çözüyor mu"yu doğrudan görebilsin diye var.
   * Tel üzerine hiçbir şey eklemez; üretim yolunda kullanılmaz.
   */
  onDecrypted?: (envelope: { brief: string; data: string; constraints: unknown; nonce: string }) => void;
}

export interface StoredResult {
  /** Alice'in replyPubKey'ine ECIES ile şifrelenmiş EchoResult. */
  cipher: string;
  receivedAt: number;
}

export interface BobAgent {
  server: Server;
  /** Dinlemeye başla, gerçek portu döndür (0 verilirse işletim sistemi seçer). */
  listen(): Promise<number>;
  close(): Promise<void>;
  url(): string;
  card(): AgentCard;
  /** Test/demo için: işlenmiş işlerin düz metin özeti (ağa çıkmaz). */
  readonly processed: EchoResult[];
  /** Hile modunu ÇALIŞIRKEN değiştir — restart YOK (BUILD-PLAN P1-D kriteri). */
  setFraudMode(mode: FraudMode): void;
  fraudMode(): FraudMode;
  /** Enclave'in (FAZ 1: binding fonksiyonunun) kayıtlı imzalayıcı adresi. */
  bindingSigner(): string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: IncomingMessage, limitBytes = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new HttpError(413, `gövde ${limitBytes} byte sınırını aştı`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createBobAgent(options: BobAgentOptions): BobAgent {
  const log = options.log ?? ((line: string) => console.log(line));
  const eciesPubKey = eciesPublicKeyOf(options.eciesPrivateKey);
  const results = new Map<string, StoredResult>();
  const processed: EchoResult[] = [];
  let boundPort = options.port ?? 0;
  // Hile modu MUTABLE: demo sırasında restart, seal key'i kaybettirir (v3 §06),
  // o yüzden mod çalışırken değişebilmeli.
  let fraudMode: FraudMode = options.fraudMode ?? 'none';
  const expectedBindingSigner = new Wallet(options.bindingKey).address;
  // Seal kimliği konteyner ömrü başına bir kez üretilir (gerçek Tapp'te wrapper üretir).
  // Süreç boyunca sabit kalması, P3-C'deki "restart etme" kuralının yerel karşılığı.
  const sealId = keccak256(toUtf8Bytes(`seal/${expectedBindingSigner}/${options.agentId}`)).slice(0, 18);
  const computeBackend = options.compute ?? createNoComputeBackend();

  const url = () => options.publicUrl ?? `http://127.0.0.1:${boundPort}`;

  const card = (): AgentCard =>
    parseOrThrow(
      AgentCardSchema,
      {
        v: 1,
        name: 'Bob',
        agentId: options.agentId,
        owner: options.owner,
        skills: options.skills,
        endpoint: `${url()}/task`,
        eciesPubKey,
        price: options.price,
        stealthMetaAddress: null, // P4-B dolduracak
        hederaAccount: options.hederaAccount ?? null,
      },
      'AgentCard',
    );

  /** FAZ 1 iş akışı: çöz → yeniden hesapla → eşleştir → şifreli sonucu sakla. */
  async function handleTask(rawBody: string): Promise<{ intentHash: string }> {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, 'gövde geçerli JSON değil');
    }

    let request;
    try {
      request = parseOrThrow(TaskRequestSchema, json, 'TaskRequest');
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }

    if (request.to !== options.agentId) {
      throw new HttpError(404, `bu agent ${options.agentId}, paket ${request.to} için gönderilmiş`);
    }

    // Çözememek bir SUNUCU hatası değil — yanlış anahtarla şifrelenmiş ya da
    // kurcalanmış bir pakettir. 400 döner, 500 ile çökmez (P1-C kapı kriteri).
    let envelopeJson: unknown;
    try {
      envelopeJson = await decryptWith(options.eciesPrivateKey, request.cipher);
    } catch (err) {
      throw new HttpError(400, `paket çözülemedi: ${err instanceof Error ? err.message : String(err)}`);
    }

    let envelope;
    try {
      envelope = parseOrThrow(TaskEnvelopeSchema, envelopeJson, 'TaskEnvelope');
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }

    options.onDecrypted?.({
      brief: envelope.brief,
      data: envelope.data,
      constraints: envelope.constraints,
      nonce: envelope.nonce,
    });

    // Alice'in imzası gerçekten Alice'ten mi? Nihai kararı P3-A'da kontrat verir;
    // burada erken uyarı olarak bakıyoruz.
    let recoveredClient = '0x0000000000000000000000000000000000000000';
    let clientSigValid = false;
    try {
      recoveredClient = recoverIntentSigner(
        {
          intentHash: envelope.intent.intentHash,
          client: envelope.intent.client,
          agentId: envelope.intent.agentId,
          price: BigInt(envelope.intent.price),
          deadline: BigInt(envelope.intent.deadline),
        },
        envelope.aliceSig,
        options.verifyingContract,
        options.chainId,
      );
      clientSigValid = recoveredClient.toLowerCase() === envelope.intent.client.toLowerCase();
    } catch {
      clientSigValid = false;
    }

    // --- hile katmanı: enclave'e GİRMEDEN önce ---
    const mode = fraudMode;
    const pre = applyPreBindingFraud(
      mode,
      {
        claimedIntentHash: envelope.intent.intentHash,
        brief: envelope.brief,
        data: envelope.data,
        constraints: envelope.constraints as Constraints,
        price: BigInt(envelope.intent.price),
        nonce: BigInt(envelope.nonce),
        agentId: options.sealAgentId ?? `agent-${options.agentId}`,
        sealId,
        timestamp: Math.floor(Date.now() / 1000).toString(),
      },
      { claimedIntentHash: envelope.intent.intentHash, clientSignatureValid: clientSigValid },
    );

    // --- DÜRÜST binding (enclave) — FRAUD_MODE buraya GİRMEZ ---
    const bound = await runBinding(pre.request, options.bindingKey, computeBackend);

    // --- hile katmanı: enclave'den DÖNDÜKTEN sonra ---
    const finalBinding = applyPostBindingFraud(mode, bound);

    // `v` atıldığı için beklenen imzacıyı vererek doğru pariteyi seçtiriyoruz.
    const bindingSigner = recoverBindingSigner(finalBinding.bodyHex, finalBinding.seal, expectedBindingSigner);
    const bindingSigOk = bindingSigner.toLowerCase() === expectedBindingSigner.toLowerCase();

    const result: EchoResult = {
      v: 1,
      stage: 'echo',
      intentHash: pre.ctx.claimedIntentHash,
      recomputedIntentHash: finalBinding.recomputedIntentHash,
      match: finalBinding.match,
      clientSigOk: pre.ctx.clientSignatureValid,
      recoveredClient,
      output: finalBinding.output,
      bodyHex: finalBinding.bodyHex,
      seal: finalBinding.seal,
      bindingSigner,
      expectedBindingSigner,
      bindingSigOk,
      computeProvider: finalBinding.computeProvider,
      ogVerified: finalBinding.ogVerified,
      ogSig: finalBinding.ogSig,
      ogSigner: finalBinding.ogSigner,
    };

    processed.push(result);
    // Sonuç, Alice'in İMZALADIĞI taahhüde göre saklanır — Bob başka bir işe cevap
    // verse bile Alice kendi intentHash'iyle sorabilsin diye.
    results.set(envelope.intent.intentHash, {
      cipher: await encryptFor(envelope.replyPubKey, result),
      receivedAt: Date.now(),
    });

    log(
      `[bob] /task intentHash=${envelope.intent.intentHash.slice(0, 12)}… mode=${mode} ` +
        `match=${finalBinding.match} clientSig=${pre.ctx.clientSignatureValid ? 'ok' : 'HATALI'} ` +
        `bindingSig=${bindingSigOk ? 'ok' : 'HATALI'}`,
    );
    return { intentHash: envelope.intent.intentHash };
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const path = (req.url ?? '').split('?')[0] ?? '';

        if (req.method === 'GET' && path === '/health') {
          sendJson(res, 200, { status: 'healthy', agentId: options.agentId, stage: 'echo' });
          return;
        }
        if (req.method === 'GET' && path === '/.well-known/agent-card.json') {
          sendJson(res, 200, card());
          return;
        }
        if (req.method === 'POST' && path === '/task') {
          const accepted = await handleTask(await readBody(req));
          // Yanıt yalnızca taahhüdü taşır — `match` şifreli sonucun İÇİNDE,
          // gözlemci işin sonucunu düz metin olarak göremesin diye.
          sendJson(res, 202, { accepted: true, intentHash: accepted.intentHash });
          return;
        }
        // Demo dApp'in fraud butonu buraya vuracak (P5-A). Restart YOK.
        if (req.method === 'POST' && path === '/admin/fraud-mode') {
          const body = await readBody(req);
          let requested: unknown;
          try {
            requested = (JSON.parse(body) as { mode?: unknown }).mode;
          } catch {
            throw new HttpError(400, 'gövde geçerli JSON değil');
          }
          if (!isFraudMode(requested)) {
            throw new HttpError(400, `bilinmeyen mod: ${String(requested)}`);
          }
          const previous = fraudMode;
          fraudMode = requested;
          log(`[bob] FRAUD_MODE ${previous} -> ${fraudMode} (restart yok)`);
          sendJson(res, 200, { previous, mode: fraudMode });
          return;
        }
        if (req.method === 'GET' && path === '/admin/fraud-mode') {
          sendJson(res, 200, { mode: fraudMode });
          return;
        }
        if (req.method === 'GET' && path.startsWith('/result/')) {
          const stored = results.get(path.slice('/result/'.length));
          if (!stored) {
            sendJson(res, 404, { error: 'NOT_FOUND', message: 'bu intentHash için sonuç yok' });
            return;
          }
          sendJson(res, 200, { cipher: stored.cipher });
          return;
        }
        sendJson(res, 404, { error: 'NOT_FOUND' });
      } catch (err) {
        if (err instanceof HttpError) {
          sendJson(res, err.status, { error: 'BAD_REQUEST', message: err.message });
          return;
        }
        log(`[bob] BEKLENMEYEN HATA: ${err instanceof Error ? err.stack : String(err)}`);
        sendJson(res, 500, { error: 'INTERNAL_ERROR' });
      }
    })();
  });

  return {
    server,
    processed,
    card,
    url,
    setFraudMode: (mode: FraudMode) => {
      log(`[bob] FRAUD_MODE ${fraudMode} -> ${mode} (restart yok)`);
      fraudMode = mode;
    },
    fraudMode: () => fraudMode,
    bindingSigner: () => expectedBindingSigner,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(options.port ?? 0, '127.0.0.1', () => {
          boundPort = (server.address() as AddressInfo).port;
          log(`[bob] agentId=${options.agentId} dinliyor: ${url()}`);
          resolve(boundPort);
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Doğrudan çalıştırılırsa .env'den kurulup ayağa kalkar. */
export async function main(): Promise<void> {
  const { loadConfig, optionalEnv, requireEnv } = await import('@ca/shared');
  const cfg = loadConfig();
  const verifyingContract = optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER;
  if (verifyingContract === PLACEHOLDER_VERIFIER) {
    console.warn(
      `[bob] UYARI: VERIFIER_ADDRESS boş — EIP-712 domain'inde yer tutucu ${PLACEHOLDER_VERIFIER} kullanılıyor.\n` +
        `      P3-A deploy edilince .env'e yazılmalı, yoksa imzalar kontratta doğrulanamaz.`,
    );
  }
  const agent = createBobAgent({
    eciesPrivateKey: requireEnv('BOB_ECIES_PRIV', 'pnpm gate:P1-B üretir'),
    agentId: requireEnv('BOB_AGENT_ID', 'pnpm gate:P0-F doldurur'),
    owner: new Wallet(cfg.PRIVATE_KEY_BOB).address,
    skills: ['market-analysis'],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract,
    // FAZ 1: binding anahtarı Bob'un cüzdanından TÜRETİLİYOR. P3-C'de bunun yerini
    // enclave'in ürettiği seal key alacak ve `setEnclaveSigner` ile on-chain kaydedilecek.
    bindingKey: keccak256(toUtf8Bytes(`phase1-binding-key/${cfg.PRIVATE_KEY_BOB}`)),
    fraudMode: isFraudMode(cfg.FRAUD_MODE) ? cfg.FRAUD_MODE : 'none',
    port: Number(process.env.BOB_PORT ?? 8801),
  });
  await agent.listen();
}
