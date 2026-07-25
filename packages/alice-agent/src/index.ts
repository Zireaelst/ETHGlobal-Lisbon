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
  agentIdToBytes32,
  buildIntentHash,
  decryptWith,
  eciesPublicKeyOf,
  encryptFor,
  intentToWire,
  parseOrThrow,
  signIntent,
} from '@ca/shared';
import { Wallet } from 'ethers';

export interface AliceJobOptions {
  /** Bob'un temel URL'i (P2-C'de The Graph'ten gelecek). */
  bobUrl: string;
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
  /** Testlerin gönderilen paketi bozabilmesi için kanca (fraud/mutasyon senaryoları). */
  tamper?: (envelope: Record<string, unknown>) => Record<string, unknown>;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export interface AliceJobReport {
  card: AgentCard;
  intent: Intent;
  signature: string;
  /** Ağa çıkan şifreli gövdenin kendisi — sızıntı taraması için. */
  sentCipher: string;
  postStatus: number;
  result: EchoResult;
  /** Alice'in imzaladığı taahhüt ile Bob'un yeniden hesapladığı aynı mı? */
  matched: boolean;
}

/** Bob'un keşif kartını çek ve doğrula. */
export async function fetchAgentCard(bobUrl: string, fetchImpl: typeof fetch = fetch): Promise<AgentCard> {
  const res = await fetchImpl(`${bobUrl.replace(/\/$/, '')}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`agent card alınamadı: HTTP ${res.status}`);
  return parseOrThrow(AgentCardSchema, await res.json(), 'AgentCard');
}

/** Uçtan uca bir iş: kart → intent → şifreli gönderim → şifreli sonuç. */
export async function runAliceJob(options: AliceJobOptions): Promise<AliceJobReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? ((line: string) => console.log(line));
  const base = options.bobUrl.replace(/\/$/, '');

  const card = await fetchAgentCard(base, fetchImpl);
  log(`[alice] Bob bulundu: agentId=${card.agentId} skills=${card.skills.join(',')}`);

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

  const sentCipher = await encryptFor(card.eciesPubKey, envelope);

  const postRes = await fetchImpl(`${base}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: card.agentId, cipher: sentCipher }),
  });
  if (postRes.status !== 202) {
    const body = await postRes.text().catch(() => '');
    throw new Error(`/task 202 dönmedi: HTTP ${postRes.status} ${body}`);
  }
  log(`[alice] paket gönderildi (${(sentCipher.length / 1024).toFixed(1)} KB şifreli)`);

  const resultRes = await fetchImpl(`${base}/result/${intentHash}`);
  if (!resultRes.ok) throw new Error(`/result alınamadı: HTTP ${resultRes.status}`);
  const { cipher } = (await resultRes.json()) as { cipher: string };

  const result = parseOrThrow(
    EchoResultSchema,
    await decryptWith(options.eciesPrivateKey, cipher),
    'EchoResult',
  );

  const matched = result.match && result.recomputedIntentHash === intentHash;
  log(`[alice] sonuç çözüldü: match=${result.match} clientSig=${result.clientSigOk ? 'ok' : 'HATALI'}`);

  return { card, intent, signature, sentCipher, postStatus: postRes.status, result, matched };
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

  const report = await runAliceJob({
    bobUrl: arg('bob') ?? process.env.BOB_URL ?? 'http://127.0.0.1:8801',
    brief: briefArg,
    data: dataFile ? readFileSync(dataFile, 'utf8') : 'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR.',
    constraints: { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 },
    wallet: new Wallet(cfg.PRIVATE_KEY_ALICE),
    eciesPrivateKey: requireEnv('ALICE_ECIES_PRIV', 'pnpm gate:P1-B üretir'),
    verifyingContract,
  });

  console.log('\n--- sonuç ---');
  console.log(report.result.output);
  console.log(`match: ${report.matched}`);
}
