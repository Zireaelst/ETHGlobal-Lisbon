// scripts/og-spike.ts — P0-B: 0G Sealed Inference tek çağrı + imza yakalama.
//
// Bu script PARA HARCAR (defter fonlama + çağrı ücreti). Fixture üretmek için
// bir kez koşulur; kapı (tests/gates/P0-B.ts) sonra fixture'ı doğrular.
//
// DÜRÜSTLÜK KURALI: SDK'nın `processResponse()`'u "geçerli" dese de ona tek
// başına güvenmiyoruz. İmzayı kendimiz indirip kendi kodumuzla kurtarıyoruz.
// İkisi de aynı sonucu vermezse fixture yazılmaz.
//
// Kaynaktan doğrulanan akış (lib.commonjs/inference/broker/{response,verifier}.js):
//   imza     : GET {svc.url}/v1/proxy/signature/{chatID}?model={model} → {text, signature}
//   doğrulama: ethers.hashMessage(text) + recoverAddress  → EIP-191 (CLAUDE.md §3.1 teyit)
//   signer   : svc.teeSignerAddress, AMA additionalInfo.TargetSeparated===true ve
//              ProviderType!=='centralized' ise additionalInfo.TargetTeeAddress
//              (model kendi ayrı TEE'sinde koşuyor demek)

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';
import { loadDotenv, optionalEnv, repoRoot, requireEnv } from '../packages/shared/src/config.js';

// SDK v0.9.0 ESM build'i kırık (bkz. scripts/og-list.ts) → CJS.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

loadDotenv();
const root = repoRoot();

/** SDK'nın istemci tarafı alt sınırı: lib.commonjs/ledger/ledger.js MIN_LEDGER_BALANCE_OG = 3. */
const SDK_MIN_LEDGER_OG = 3;

/** Görüntü modelleri metin analizi yapmıyor — sağlayıcı seçiminden elenir. */
const IMAGE_MODEL_HINT = /image|vision|diffusion/i;

const PROMPT =
  'You are a security analyst. In exactly three sentences, explain why binding a ' +
  'payment intent hash to a model output matters for autonomous agent marketplaces.';

const provider = new ethers.JsonRpcProvider(requireEnv('OG_RPC_URL'));
const wallet = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);
const log = (l: string) => console.log(l);

log(`cüzdan : ${wallet.address}`);
log(`bakiye : ${ethers.formatEther(await provider.getBalance(wallet.address))} OG\n`);

const broker = await createZGComputeNetworkBroker(wallet);

// ---------------------------------------------------------------------------
// 1. Defter — yoksa aç
// ---------------------------------------------------------------------------
let ledger: { totalBalance: bigint; availableBalance: bigint } | undefined;
try {
  ledger = await broker.ledger.getLedger();
} catch {
  ledger = undefined;
}

if (!ledger) {
  log(`defter yok → addLedger(${SDK_MIN_LEDGER_OG}) …`);
  await broker.ledger.addLedger(SDK_MIN_LEDGER_OG);
  ledger = await broker.ledger.getLedger();
}
// Sağlayıcı alt hesabı açmak defterden 1 OG (MIN_TRANSFER_AMOUNT) kilitliyor.
// Kullanılabilir bakiye bunun altına düşerse SDK otomatik fonlamayı yapamıyor
// ve uyarı basıp geçiyor. Peşinen dolduruyoruz.
const MIN_AVAILABLE_OG = 10n ** 18n;
if (ledger!.availableBalance < MIN_AVAILABLE_OG) {
  log(`kullanılabilir bakiye düşük (${ethers.formatEther(ledger!.availableBalance)} OG) → depositFund(2) …`);
  await broker.ledger.depositFund(2);
  ledger = await broker.ledger.getLedger();
}
log(`defter : ${ethers.formatEther(ledger!.totalBalance)} OG toplam / ${ethers.formatEther(ledger!.availableBalance)} OG kullanılabilir\n`);

// ---------------------------------------------------------------------------
// 2. Sağlayıcı seçimi — SADECE TeeML
// ---------------------------------------------------------------------------
type Service = {
  provider: string;
  model: string;
  url: string;
  verifiability: string;
  inputPrice: bigint;
  outputPrice: bigint;
  additionalInfo: string;
  teeSignerAddress: string;
  teeSignerAcknowledged: boolean;
};

// listService bir ethers `Result` döndürüyor: DONMUŞ dizi. filter() de Result
// üretiyor, o yüzden sort() "Cannot assign to read only property" veriyor.
// Array.from ile düz diziye kopyalıyoruz.
const services: Service[] = Array.from(await broker.inference.listService(0, 50, true));
const teeml = Array.from(services.filter((s) => s.verifiability === 'TeeML'));
if (teeml.length === 0) throw new Error('ağda TeeML sağlayıcı yok — P0-B ilerleyemez');

const pinned = optionalEnv('OG_PROVIDER_ADDRESS');
let chosen: Service | undefined;
if (pinned) {
  chosen = teeml.find((s) => s.provider.toLowerCase() === pinned.toLowerCase());
  if (!chosen) throw new Error(`OG_PROVIDER_ADDRESS=${pinned} TeeML listesinde yok`);
} else {
  // ONAY ŞARTI: `teeSignerAcknowledged` false ise, o sağlayıcının TEE signer
  // adresi kontratta SAĞLAYICININ KENDİ BEYANI olarak duruyor — kontrat sahibi
  // ona kefil olmamış. processResponse bu durumda false döner (kaynak:
  // lib.commonjs/inference/broker/response.js:36). Onaysız sağlayıcıyla imza
  // doğrulasak bile "0G TEE'si üretti" diyemeyiz, o yüzden burada eliyoruz.
  const eligible = Array.from(
    teeml.filter((s) => s.teeSignerAcknowledged && !IMAGE_MODEL_HINT.test(s.model)),
  );
  if (eligible.length === 0) {
    const why = teeml
      .map((s) => `  ${s.provider} ${s.model} — onaylı:${s.teeSignerAcknowledged}`)
      .join('\n');
    throw new Error(`onaylı TeeML metin sağlayıcısı yok:\n${why}`);
  }
  chosen = eligible.sort((a, b) => (a.outputPrice === b.outputPrice
    ? Number(a.inputPrice - b.inputPrice)
    : Number(a.outputPrice - b.outputPrice)))[0];
}
if (!chosen) throw new Error('uygun TeeML metin sağlayıcısı bulunamadı');
if (!chosen.teeSignerAcknowledged) {
  throw new Error(`sabitlenen sağlayıcı ${chosen.provider} onaysız — imza doğrulanamaz`);
}

log(`sağlayıcı : ${chosen.provider}`);
log(`model     : ${chosen.model}`);
log(`url       : ${chosen.url}`);
log(`fiyat     : input ${chosen.inputPrice} / output ${chosen.outputPrice} neuron\n`);

// ---------------------------------------------------------------------------
// 3. TEE signer + onay
// ---------------------------------------------------------------------------
let status = await broker.inference.checkProviderSignerStatus(chosen.provider);
if (!status.isAcknowledged) {
  log('sağlayıcı onaylı değil → acknowledgeProviderSigner() …');
  await broker.inference.acknowledgeProviderSigner(chosen.provider);
  status = await broker.inference.checkProviderSignerStatus(chosen.provider);
}
if (!status.isAcknowledged) throw new Error('acknowledgeProviderSigner sonrası hâlâ onaysız');
log(`TEE signer (kontrat): ${status.teeSignerAddress}`);

// İmzayı hangi adrese karşı doğrulayacağımız additionalInfo'ya bağlı olabilir.
let expectedSigner: string = status.teeSignerAddress;
let targetSeparated = false;
let providerType = 'decentralized';
if (chosen.additionalInfo) {
  try {
    const info = JSON.parse(chosen.additionalInfo) as {
      ProviderType?: string;
      TargetSeparated?: boolean;
      TargetTeeAddress?: string;
    };
    providerType = info.ProviderType ?? 'decentralized';
    targetSeparated = info.TargetSeparated === true;
    if (targetSeparated && providerType !== 'centralized' && info.TargetTeeAddress) {
      expectedSigner = info.TargetTeeAddress;
      log(`ayrık TEE  : model kendi enclave'inde → beklenen imzacı ${expectedSigner}`);
    }
  } catch {
    log('UYARI: additionalInfo JSON olarak ayrıştırılamadı');
  }
}
log('');

// ---------------------------------------------------------------------------
// 4. Çağrı
// ---------------------------------------------------------------------------
const { endpoint, model } = await broker.inference.getServiceMetadata(chosen.provider);
log(`endpoint : ${endpoint}`);
log(`model    : ${model}\n`);

// Header'lar TEK KULLANIMLIK — her istek için yeniden alınır.
const headers = await broker.inference.getRequestHeaders(chosen.provider);

const body = {
  model,
  messages: [{ role: 'user', content: PROMPT }],
};

log('çağrı yapılıyor …');
const startedAt = Date.now();
const res = await fetch(`${endpoint}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
  body: JSON.stringify(body),
});
const latencyMs = Date.now() - startedAt;

if (!res.ok) {
  throw new Error(`çağrı başarısız: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
}

// HAM gövdeyi saklıyoruz. İmza sha256(ham gövde) üzerine atılıyor; JSON'u
// parse edip tekrar stringify etmek anahtar sırasına bağlı kalır ve sağlayıcı
// alan sırasını değiştirdiği gün sessizce bozulur.
const rawResponseText = await res.text();
const completion = JSON.parse(rawResponseText) as {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: Record<string, number>;
};
// chatID ÖNCE `ZG-Res-Key` başlığından okunur, `completion.id` sadece yedek.
// Kaynak: cli.commonjs/sdk/inference/broker/broker.js:342 —
//   const chatID = response.headers.get('ZG-Res-Key') || completion.id
// completion.id ile imza sunucusu "chat_id_not_found" veriyor.
const resKey = res.headers.get('ZG-Res-Key');
const chatID = resKey ?? completion.id;
const output = completion.choices?.[0]?.message?.content ?? '';
log(`ZG-Res-Key: ${resKey ?? '(başlık yok — completion.id kullanılıyor)'}`);

log(`yanıt    : ${latencyMs} ms, chatID=${chatID}`);
log(`çıktı    : ${output.slice(0, 160)}${output.length > 160 ? '…' : ''}\n`);
if (!chatID) throw new Error('yanıtta chatID (id) yok — imza indirilemez');

// ---------------------------------------------------------------------------
// 5. İmza — SDK ile VE kendi kodumuzla
// ---------------------------------------------------------------------------
// Bağımsız yol ÖNCE: imzayı kendimiz indiriyoruz ki hata çıkarsa SDK'nın
// yuttuğu "getting signature error" yerine gerçek HTTP durumunu görelim.
//
// İmza sunucu tarafında çağrıdan hemen sonra hazır olmayabiliyor → kısa backoff.
// URL varyantları: SDK model'i encode ETMİYOR ama model adında `/` var
// (qwen/qwen2.5-omni-7b), o yüzden iki biçimi de deniyoruz.
type SigResponse = { text: string; signature: string };

const sigVariants = [
  `${chosen.url}/v1/proxy/signature/${chatID}?model=${chosen.model}`,
  `${chosen.url}/v1/proxy/signature/${chatID}?model=${encodeURIComponent(chosen.model)}`,
  `${chosen.url}/v1/proxy/signature/${chatID}`,
];

let sig: SigResponse | undefined;
let sigUrlUsed = '';
const attempts: string[] = [];

for (let round = 0; round < 6 && !sig; round += 1) {
  for (const url of sigVariants) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (r.ok) {
      sig = (await r.json()) as SigResponse;
      sigUrlUsed = url;
      break;
    }
    attempts.push(`HTTP ${r.status} ${url.replace(chosen.url, '')} → ${(await r.text()).slice(0, 120)}`);
  }
  if (!sig) await new Promise((r) => setTimeout(r, 1500));
}

if (!sig) {
  throw new Error(`imza indirilemedi. Denemeler:\n${attempts.slice(-6).join('\n')}`);
}
log(`imza URL : ${sigUrlUsed.replace(chosen.url, '')}`);

let sdkValid: boolean | null = null;
try {
  sdkValid = await broker.inference.processResponse(
    chosen.provider,
    chatID,
    JSON.stringify(completion.usage ?? {}),
  );
} catch (err) {
  log(`SDK processResponse HATA: ${(err as Error).message}`);
}
log(`SDK processResponse : ${sdkValid}`);

const recovered = ethers.verifyMessage(sig.text, sig.signature);
const ourValid = recovered.toLowerCase() === expectedSigner.toLowerCase();

log(`imzalı metin        : ${sig.text.length} karakter`);
log(`kurtarılan adres    : ${recovered}`);
log(`beklenen imzacı     : ${expectedSigner}`);
log(`BİZİM doğrulamamız  : ${ourValid}\n`);

if (!ourValid) {
  throw new Error(
    `İMZA DOĞRULANAMADI — kurtarılan ${recovered}, beklenen ${expectedSigner}. Fixture yazılmadı.`,
  );
}
if (sdkValid !== true) {
  throw new Error(`SDK processResponse ${sdkValid} döndü, biz true bulduk — çelişki. Fixture yazılmadı.`);
}

// ---------------------------------------------------------------------------
// 5b. İmza NEYİ kapsıyor? — CLAUDE.md §3.1 düzeltmesi
//
// §3.1 "imza ÇIKTI metnini kapsar" diyor. Bu sağlayıcıda öyle DEĞİL. İmzalanan
// metin bir demet:
//     "<h1>:<h2>:<ProviderType>:<ProviderIdentity>:<h3>"
// Deneyle bulundu: h2 === sha256(ham yanıt gövdesi). Yani çıktı imza kapsamında,
// ama düz metin olarak değil — gövdenin özeti olarak.
//
// Bunu kendimiz yeniden hesaplayıp doğruluyoruz; "imza çıktıya bağlı" cümlesini
// kurabilmemizin tek dayanağı bu eşitlik.
// ---------------------------------------------------------------------------
const sigParts = sig.text.split(':');
const responseDigest = createHash('sha256').update(rawResponseText).digest('hex');
const digestIndex = sigParts.indexOf(responseDigest);
const signedCoversOutput = digestIndex !== -1;

log(`imzalı demet parça sayısı : ${sigParts.length}`);
log(`sha256(ham yanıt)         : ${responseDigest}`);
log(`demetteki konumu          : ${digestIndex === -1 ? 'YOK' : `#${digestIndex}`}`);

if (!signedCoversOutput) {
  throw new Error(
    'İmzalanan demet yanıt gövdesinin sha256\'sını İÇERMİYOR — imza çıktıya bağlı ' +
      `değil demektir, tez bu haliyle kurulamaz.\ndemet: ${sig.text}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Fixture
// ---------------------------------------------------------------------------
const dir = resolve(root, 'fixtures/og');
mkdirSync(dir, { recursive: true });

writeFileSync(
  resolve(dir, 'signer.json'),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      chainId: 16602,
      provider: chosen.provider,
      model: chosen.model,
      url: chosen.url,
      verifiability: chosen.verifiability,
      teeSignerAddress: status.teeSignerAddress,
      expectedSigner,
      targetSeparated,
      providerType,
      isAcknowledged: status.isAcknowledged,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

writeFileSync(
  resolve(dir, 'run-1.json'),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      request: { endpoint, model, prompt: PROMPT },
      response: completion,
      rawResponseText,
      output,
      latencyMs,
      chatID,
      signature: sig,
      verification: {
        sdkProcessResponse: sdkValid,
        independentRecovered: recovered,
        expectedSigner,
        independentValid: ourValid,
        signedTextCoversOutput: signedCoversOutput,
        scheme: 'EIP-191 (ethers.verifyMessage)',
        signedTuple: sig.text,
        signedTupleParts: sigParts,
        responseSha256: responseDigest,
        responseDigestIndexInTuple: digestIndex,
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const after = await broker.ledger.getLedger();
const spent = ledger!.totalBalance - after.totalBalance;

log('fixtures/og/signer.json + fixtures/og/run-1.json yazıldı');
log(`defter sonrası : ${ethers.formatEther(after.totalBalance)} OG (bu çağrı ~${ethers.formatEther(spent)} OG)`);
log(`imzalı metin çıktıyı kapsıyor mu: ${signedCoversOutput}`);
