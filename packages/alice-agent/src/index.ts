// alice-agent — istemci agent (BUILD-PLAN §2.1).
//
// FAZ 1 kapsamı: Bob'un kartını çek → intent kur → EIP-712 imzala → ECIES'le şifrele →
// /task'a gönder → /result'tan sonucu al → çöz. Keşif (The Graph) P2-C'de, ödeme P4'te.
//
// Alice'in imzaladığı şey İÇERİK DEĞİL, `intentHash` taahhüdüdür (BUILD-PLAN §2.3).
// Bob'un yeniden hesapladığı taahhüt bununla tutmazsa iş "sipariş edilen iş" değildir.

import {
  AgentCardSchema,
  EchoResultSchema,
  PLACEHOLDER_VERIFIER,
  type AgentCard,
  type Constraints,
  type EchoResult,
  type Intent,
  type PaymentAuthorization,
  type PaymentRequirements,
  type Seal,
  agentIdToBytes32,
  buildIntentHash,
  decryptWith,
  eciesPublicKeyOf,
  encryptFor,
  intentToWire,
  parseOrThrow,
  pickBestAgent,
  signIntent,
  type DiscoveredAgent,
} from '@ca/shared';
import type { PaymentBackend } from '@ca/payment';
import { Wallet } from 'ethers';

export interface AliceJobOptions {
  /**
   * Bob'un temel URL'i. VERİLMEZSE `discover` üzerinden The Graph'ten bulunur.
   * İkisinden biri zorunlu.
   */
  bobUrl?: string;
  /**
   * Keşif: skill ile ara, subgraph'ın verdiği endpoint ve ECIES pubkey'i kullan.
   * Alice'in Bob'un adresini bilmemesi The Graph'ın load-bearing olduğunun kanıtı.
   */
  discover?: { subgraphUrl: string; skill: string };
  brief: string;
  data: string;
  constraints: Constraints;
  /** Alice'in imzalama cüzdanı (PRIVATE_KEY_ALICE). */
  wallet: Wallet;
  /** Alice'in ECIES private key'i — sonuç buna şifrelenir. */
  eciesPrivateKey: string;
  verifyingContract: string;
  chainId?: number;
  nonce?: bigint;
  /** Unix saniye. Verilmezse +1 saat. */
  deadline?: bigint;
  /**
   * Ödeme backend'i. Bob 402 dönerse Alice bununla yetkilendirir.
   * Verilmezse ve Bob ödeme isterse iş HATA ile durur — sessizce devam etmez.
   */
  payment?: { backend: PaymentBackend };
  /** Testlerin gönderilen paketi bozabilmesi için kanca (fraud/mutasyon senaryoları). */
  tamper?: (envelope: Record<string, unknown>) => Record<string, unknown>;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export interface AliceJobReport {
  /** Keşif kullanıldıysa subgraph'tan gelen kayıt. */
  discovered?: DiscoveredAgent;
  card: AgentCard;
  intent: Intent;
  signature: string;
  /** Ağa çıkan şifreli gövdenin kendisi — sızıntı taraması için. */
  sentCipher: string;
  postStatus: number;
  result: EchoResult;
  /** Alice'in imzaladığı taahhüt ile Bob'un yeniden hesapladığı aynı mı? */
  matched: boolean;
  /**
   * Bob'un zincire götürülmesini İDDİA ETTİĞİ gövde ve seal.
   *
   * Zincire giden bunlardır — enclave'in Alice'e şifrelediği kopya değil.
   * `forge` modunda ikisi ayrışır ve `sealTampered` true olur.
   */
  claimedBodyHex: string;
  claimedSeal: Seal;
  /** Bob çıkan imzayı/gövdeyi değiştirdi mi? */
  sealTampered: boolean;
  /** Bob 402 döndü mü — yani ödeme kapısı gerçekten çalıştı mı? */
  paymentRequired: boolean;
}

/** Bob'un keşif kartını çek ve doğrula. */
export async function fetchAgentCard(bobUrl: string, fetchImpl: typeof fetch = fetch): Promise<AgentCard> {
  const res = await fetchImpl(`${bobUrl.replace(/\/$/, '')}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`agent card alınamadı: HTTP ${res.status}`);
  return parseOrThrow(AgentCardSchema, await res.json(), 'AgentCard');
}

/** Uçtan uca bir iş: (keşif →) kart → intent → şifreli gönderim → şifreli sonuç. */
export async function runAliceJob(options: AliceJobOptions): Promise<AliceJobReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? ((line: string) => console.log(line));

  // --- keşif: adresi bilmiyorsak The Graph'ten bul ---
  let discovered: DiscoveredAgent | undefined;
  let base: string;
  if (options.bobUrl) {
    base = options.bobUrl.replace(/\/$/, '');
  } else if (options.discover) {
    discovered = await pickBestAgent(options.discover.subgraphUrl, options.discover.skill);
    if (!discovered.endpoint) throw new Error(`keşfedilen agent ${discovered.agentId} endpoint taşımıyor`);
    // Kayıtlı endpoint iş ucudur (`.../task`); temel adres onun bir üstü.
    base = discovered.endpoint.replace(/\/task\/?$/, '').replace(/\/$/, '');
    log(
      `[alice] The Graph'ten keşfedildi: agentId=${discovered.agentId} ` +
        `skills=${discovered.skills.join(',')} verifiedDeliveries=${discovered.verifiedDeliveries}`,
    );
  } else {
    throw new Error('bobUrl ya da discover verilmeli');
  }

  const card = await fetchAgentCard(base, fetchImpl);
  log(`[alice] agent card alındı: agentId=${card.agentId} skills=${card.skills.join(',')}`);

  // Keşif ile kartın anlaşmadığı bir durumda SESSİZCE devam etmek, yanlış alıcıya
  // şifrelemek demektir. Uyuşmazlığı hata olarak veriyoruz.
  if (discovered) {
    if (card.agentId !== discovered.agentId) {
      throw new Error(`keşif agentId ${discovered.agentId} ≠ kart agentId ${card.agentId}`);
    }
    if (discovered.eciesPubKey && card.eciesPubKey !== discovered.eciesPubKey) {
      throw new Error('keşfedilen eciesPubKey ile karttaki anahtar farklı — hangisinin güncel olduğu belirsiz');
    }
  }

  const nonce = options.nonce ?? BigInt(Date.now());
  const price = BigInt(card.price.amount);
  const deadline = options.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);

  const intentHash = buildIntentHash({
    brief: options.brief,
    data: options.data,
    constraints: options.constraints,
    price,
    nonce,
  });

  const intent: Intent = {
    intentHash,
    client: options.wallet.address,
    agentId: agentIdToBytes32(card.agentId),
    price,
    deadline,
  };

  const signature = await signIntent(intent, options.wallet, options.verifyingContract, options.chainId);
  log(`[alice] intent imzalandı: ${intentHash.slice(0, 14)}…`);

  let envelope: Record<string, unknown> = {
    v: 1,
    intent: intentToWire(intent),
    aliceSig: signature,
    brief: options.brief,
    data: options.data,
    constraints: options.constraints,
    nonce: nonce.toString(),
    replyPubKey: eciesPublicKeyOf(options.eciesPrivateKey),
  };
  // Kurcalama KANCASI: imza atıldıktan SONRA uygulanır — tam da bir saldırganın
  // yapabileceği şey. Böylece "tek karakter değişti" senaryosu gerçekçi olur.
  if (options.tamper) envelope = options.tamper(envelope);

  // Keşif kullanıldıysa ZİNCİRDEN indekslenen anahtarla şifrele: kaynak The Graph,
  // Bob'un kendi beyanı değil. (Yukarıda ikisinin eşit olduğu zaten doğrulandı.)
  const encryptTo = discovered?.eciesPubKey ?? card.eciesPubKey;
  const sentCipher = await encryptFor(encryptTo, envelope);

  // `intentHash` ve `replyPubKey` şifre DIŞINDA gidiyor: Bob'un dış katmanı paketi
  // çözemiyor (anahtar enclave'de) ama işi yönlendirip sonucu teslim edebilmeli.
  // Sızıntı yok — ikisi de zaten herkese açık (zincirde ve Alice'in 8004 kaydında).
  const taskBody = {
    to: card.agentId,
    intentHash,
    replyPubKey: eciesPublicKeyOf(options.eciesPrivateKey),
    cipher: sentCipher,
  };
  const send = (payment?: unknown) =>
    fetchImpl(`${base}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payment ? { ...taskBody, payment } : taskBody),
    });

  // x402 akışı: önce ödemesiz dene. Bob 402 dönerse yetkilendirip TEKRAR gönder.
  let postRes = await send();
  let paymentAuthorized: PaymentAuthorization | undefined;

  if (postRes.status === 402) {
    if (!options.payment) {
      throw new Error('Bob ödeme istedi (402) ama Alice\'e ödeme backend\'i verilmedi');
    }
    const body = (await postRes.json()) as { accepts?: PaymentRequirements[] };
    const requirements = body.accepts?.[0];
    if (!requirements) throw new Error('402 yanıtında ödeme şartları yok');
    log(`[alice] 402 alındı: ${requirements.amount} ${requirements.asset} (${requirements.rail})`);

    // Yetkilendirme — PARA HAREKET ETMEZ. Bob bunu tutar, JobVerified sonrası gönderir.
    const quote = await options.payment.backend.quote({
      intentHash: requirements.intentHash,
      amount: requirements.amount,
      recipient: requirements.recipient,
    });
    paymentAuthorized = (await options.payment.backend.authorize(quote)) as unknown as PaymentAuthorization;
    log('[alice] ödeme yetkisi imzalandı — para henüz Alice\'te');

    postRes = await send(paymentAuthorized);
  }

  if (postRes.status !== 202) {
    const body = await postRes.text().catch(() => '');
    throw new Error(`/task 202 dönmedi: HTTP ${postRes.status} ${body}`);
  }
  log(`[alice] paket gönderildi (${(sentCipher.length / 1024).toFixed(1)} KB şifreli)`);

  const resultRes = await fetchImpl(`${base}/result/${intentHash}`);
  if (!resultRes.ok) throw new Error(`/result alınamadı: HTTP ${resultRes.status}`);
  const claimed = (await resultRes.json()) as { cipher: string; bodyHex: string; seal: Seal };

  // Enclave'in Alice'e ŞİFRELEDİĞİ sonuç — Bob buna dokunamaz.
  const result = parseOrThrow(
    EchoResultSchema,
    await decryptWith(options.eciesPrivateKey, claimed.cipher),
    'EchoResult',
  );

  // Bob'un zincire götürülmesini istediği artefaktlar enclave'inkiyle aynı mı?
  // Farklıysa Bob çıkan imzayı/gövdeyi değiştirmiş demektir (`forge` modu).
  const sealTampered =
    claimed.bodyHex !== result.bodyHex ||
    claimed.seal.r !== result.seal.r ||
    claimed.seal.s !== result.seal.s;
  if (sealTampered) {
    log('[alice] UYARI: Bob\'un ilettiği gövde/seal enclave\'in imzaladığından FARKLI');
  }

  const matched = result.match && result.recomputedIntentHash === intentHash && !sealTampered;
  log(`[alice] sonuç çözüldü: match=${result.match} clientSig=${result.clientSigOk ? 'ok' : 'HATALI'}`);

  return {
    discovered,
    card,
    intent,
    signature,
    sentCipher,
    postStatus: postRes.status,
    result,
    matched,
    claimedBodyHex: claimed.bodyHex,
    claimedSeal: claimed.seal,
    sealTampered,
    paymentRequired: paymentAuthorized !== undefined,
  };
}

/** Doğrudan çalıştırılırsa .env'den kurulup tek iş koşar. */
export async function main(): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const { loadConfig, optionalEnv, requireEnv } = await import('@ca/shared');
  const cfg = loadConfig();

  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const briefArg = arg('brief') ?? 'Analyse the attached report and flag revenue-recognition risks.';
  const dataFile = arg('data');

  const verifyingContract = optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER;
  if (verifyingContract === PLACEHOLDER_VERIFIER) {
    console.warn(
      `[alice] UYARI: VERIFIER_ADDRESS boş — yer tutucu ${PLACEHOLDER_VERIFIER} ile imzalanıyor.\n` +
        `        Bu imza gerçek Verifier kontratında DOĞRULANAMAZ (P3-A deploy edilince .env'e yazın).`,
    );
  }

  // VARSAYILAN YOL KEŞİFTİR. `--bob` yalnızca yerel hata ayıklama içindir; Alice'in
  // Bob'un adresini bilmesi gerekmiyor (BUILD-PLAN P2-C).
  const explicitBob = arg('bob') ?? process.env.BOB_URL;
  const skill = arg('skill') ?? 'market-analysis';

  const report = await runAliceJob({
    bobUrl: explicitBob,
    discover: explicitBob
      ? undefined
      : { subgraphUrl: requireEnv('SUBGRAPH_QUERY_URL', 'pnpm gate:P2-B doldurur'), skill },
    brief: briefArg,
    data: dataFile ? readFileSync(dataFile, 'utf8') : 'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR.',
    constraints: { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 },
    wallet: new Wallet(cfg.PRIVATE_KEY_ALICE),
    eciesPrivateKey: requireEnv('ALICE_ECIES_PRIV', 'pnpm gate:P1-B üretir'),
    verifyingContract,
  });

  console.log('\n--- sonuç ---');
  if (report.discovered) {
    console.log(
      `keşif: The Graph → agentId ${report.discovered.agentId} ` +
        `(verifiedDeliveries ${report.discovered.verifiedDeliveries})`,
    );
  }
  console.log(report.result.output);
  console.log(`match: ${report.matched}`);
}
