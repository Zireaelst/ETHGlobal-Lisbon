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

import {
  AgentCardSchema,
  PLACEHOLDER_VERIFIER,
  TaskEnvelopeSchema,
  TaskRequestSchema,
  type AgentCard,
  type Constraints,
  type EchoResult,
  buildIntentHash,
  decryptWith,
  eciesPublicKeyOf,
  encryptFor,
  parseOrThrow,
  recoverIntentSigner,
} from '@ca/shared';

export interface BobAgentOptions {
  /** Bob'un ECIES private key'i (BOB_ECIES_PRIV). */
  eciesPrivateKey: string;
  /** ERC-8004 agentId, decimal string. */
  agentId: string;
  /** Bob'un cüzdan adresi (kayıt sahibi). */
  owner: string;
  skills: string[];
  price: { amount: string; asset: string; decimals: number };
  /** EIP-712 domain'inin verifyingContract'ı — Alice'in imzasını doğrulamak için. */
  verifyingContract: string;
  chainId?: number;
  port?: number;
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

    // İŞİN ÖZÜ: taahhüdü Alice'in söylediğine göre değil, GELEN İÇERİKTEN yeniden hesapla.
    const recomputed = buildIntentHash({
      brief: envelope.brief,
      data: envelope.data,
      constraints: envelope.constraints as Constraints,
      price: BigInt(envelope.intent.price),
      nonce: BigInt(envelope.nonce),
    });
    const match = recomputed === envelope.intent.intentHash;

    // Alice'in imzası gerçekten Alice'ten mi? Nihai kararı P3-A'da kontrat verir;
    // burada erken uyarı olarak bakıyoruz.
    let recoveredClient = '0x0000000000000000000000000000000000000000';
    let clientSigOk = false;
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
      clientSigOk = recoveredClient.toLowerCase() === envelope.intent.client.toLowerCase();
    } catch {
      clientSigOk = false;
    }

    const result: EchoResult = {
      v: 1,
      stage: 'echo',
      intentHash: envelope.intent.intentHash,
      recomputedIntentHash: recomputed,
      match,
      clientSigOk,
      recoveredClient,
      output: match
        ? `[FAZ 1 echo] Brief alındı (${envelope.brief.length} karakter), veri ${envelope.data.length} karakter. ` +
          `Gerçek analiz P3-B'de 0G Sealed Inference'tan gelecek.`
        : '[FAZ 1 echo] intentHash uyuşmadı — iş yapılmadı.',
    };

    processed.push(result);
    results.set(envelope.intent.intentHash, {
      cipher: await encryptFor(envelope.replyPubKey, result),
      receivedAt: Date.now(),
    });

    log(
      `[bob] /task intentHash=${envelope.intent.intentHash.slice(0, 12)}… ` +
        `match=${match} clientSig=${clientSigOk ? 'ok' : 'HATALI'}`,
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
  const { Wallet } = await import('ethers');
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
    port: Number(process.env.BOB_PORT ?? 8801),
  });
  await agent.listen();
}
