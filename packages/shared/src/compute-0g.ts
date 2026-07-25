// compute-0g.ts — GERÇEK 0G Sealed Inference backend'i (enclave içinden çağrılır).
//
// BUILD-PLAN P3-B/4: 0G imzası ENCLAVE İÇİNDE doğrulanır; kontrat bu bayrağa güvenir.
// Doğrulanamıyorsa `ogVerified: false` girer — sessizce true YAZILMAZ.
//
// İMZA NEYİ KAPSIYOR (P0-B'de ölçüldü, CLAUDE.md §3.1):
//     "<h1>:<sha256(ham yanıt gövdesi)>:<ProviderType>:<ProviderIdentity>:<h3>"
// Bu yüzden doğrulama İKİ adımlı ve ikisi de şart:
//   (a) verifyMessage(demet, imza) === beklenen imzacı
//         → gerçek bir 0G TEE'si BİR ŞEY imzalamış
//   (b) sha256(ham yanıt) demetin içinde
//         → imzaladığı şey BİZİM yanıtımız
// (a) tek başına yetseydi, saldırgan başka bir isteğe ait geçerli bir TEE imzasını
// bize verip "işte kanıt" diyebilirdi. (b) o kapıyı kapatıyor.
//
// AĞ ÇIKIŞI: bu modül yalnızca 0G RPC'sine ve seçilen sağlayıcının endpoint'ine
// çıkar (P3-B kriteri — `imageHash` iddiasını kirletmemek için).

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyMessage } from 'ethers';

import type { ComputeBackend, ComputeRequest, ComputeResult } from './compute.js';
import { recordRun, computeRequestKey } from './compute-fixture.js';

// SDK v0.9.0'ın ESM build'i kırık (lib.esm/index.mjs, CJS chunk'tan isimlendirilmiş
// export çekiyor → SyntaxError). CJS build'i sağlam.
const require = createRequire(import.meta.url);

export interface ZeroGBackendOptions {
  rpcUrl: string;
  /** 0G ödemelerini yapan cüzdanın anahtarı. Enclave dışına ÇIKMAZ. */
  privateKey: string;
  /** Sabitlenmiş sağlayıcı. Boşsa onaylı TeeML'ler arasından en ucuzu seçilir. */
  providerAddress?: string;
  /** Her gerçek çağrıyı buraya kaydet (P0-D/4 fixture disiplini). Boşsa kayıt yok. */
  recordDir?: string;
  /** Çağrı üst sınırı — sağlayıcı takılırsa enclave sonsuza kadar beklemesin. */
  timeoutMs?: number;
}

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

/** P0-G bütçesi 60 sn; tek çağrı için yarısını üst sınır alıyoruz. */
const DEFAULT_TIMEOUT_MS = 30_000;

const IMAGE_MODEL_HINT = /image|vision|diffusion/i;

/** İmzanın hangi adrese ait olması gerektiğini `additionalInfo`'dan çöz. */
function resolveExpectedSigner(svc: Service): string {
  if (!svc.additionalInfo) return svc.teeSignerAddress;
  try {
    const info = JSON.parse(svc.additionalInfo) as {
      ProviderType?: string;
      TargetSeparated?: boolean;
      TargetTeeAddress?: string;
    };
    const centralized = (info.ProviderType ?? 'decentralized') === 'centralized';
    // Ayrık ve merkezi DEĞİLSE model kendi enclave'inde koşuyor demektir ve
    // imzayı o atar; merkezi sağlayıcıda broker TEE'si imzalar.
    if (info.TargetSeparated === true && !centralized && info.TargetTeeAddress) {
      return info.TargetTeeAddress;
    }
  } catch {
    // additionalInfo bozuksa kontrattaki adrese düşüyoruz — uydurmuyoruz.
  }
  return svc.teeSignerAddress;
}

/** Brief + veri + kısıtları modele verilecek tek isteme çevir. */
function buildPrompt(request: ComputeRequest): string {
  return [
    'You are an expert analyst. Produce the deliverable described in the brief.',
    '',
    `BRIEF:\n${request.brief}`,
    '',
    `DATA:\n${request.data}`,
  ].join('\n');
}

export function createZeroGComputeBackend(options: ZeroGBackendOptions): ComputeBackend {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Broker kurulumu pahalı (zincir okumaları) — ilk çağrıda kurup saklıyoruz.
  let ready: Promise<{ broker: any; svc: Service; expectedSigner: string }> | undefined;

  async function init() {
    const { ethers } = await import('ethers');
    const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

    const provider = new ethers.JsonRpcProvider(options.rpcUrl);
    const wallet = new ethers.Wallet(options.privateKey, provider);
    const broker = await createZGComputeNetworkBroker(wallet);

    // DİKKAT: inference tarafının imzası (offset, limit, includeUnacknowledged);
    // kontrat limit'i 50 ile sınırlıyor. Dönen değer donmuş bir ethers Result.
    const services: Service[] = Array.from(await broker.inference.listService(0, 50, true));

    let picked: Service | undefined;
    if (options.providerAddress) {
      picked = services.find((s) => s.provider.toLowerCase() === options.providerAddress!.toLowerCase());
      if (!picked) throw new Error(`0G sağlayıcısı listede yok: ${options.providerAddress}`);
    } else {
      const eligible = Array.from(
        services.filter(
          (s) => s.verifiability === 'TeeML' && s.teeSignerAcknowledged && !IMAGE_MODEL_HINT.test(s.model),
        ),
      );
      if (eligible.length === 0) throw new Error('onaylı TeeML metin sağlayıcısı yok');
      picked = eligible.sort((a, b) => Number(a.outputPrice - b.outputPrice))[0];
    }
    if (!picked) throw new Error('0G sağlayıcısı seçilemedi');
    const svc: Service = picked;

    // TeeTLS "operatör veriyi göremez" iddiasını taşımıyor — kabul etmiyoruz.
    if (svc.verifiability !== 'TeeML') {
      throw new Error(`sağlayıcı TeeML değil: ${svc.verifiability}`);
    }
    // Onaysızda teeSignerAddress sağlayıcının kendi beyanıdır; kontrat kefil değildir.
    if (!svc.teeSignerAcknowledged) {
      throw new Error(`sağlayıcının TEE signer'ı kontratta onaylı değil: ${svc.provider}`);
    }

    return { broker, svc, expectedSigner: resolveExpectedSigner(svc) };
  }

  return {
    provider: '0g-sealed-inference',

    async run(request: ComputeRequest): Promise<ComputeResult> {
      ready = ready ?? init();
      const { broker, svc, expectedSigner } = await ready;

      const { endpoint, model } = await broker.inference.getServiceMetadata(svc.provider);
      // Header'lar TEK KULLANIMLIK — her istek için yeniden alınır.
      const headers = (await broker.inference.getRequestHeaders(svc.provider)) as Record<string, string>;

      const body = {
        model,
        messages: [{ role: 'user', content: buildPrompt(request) }],
        max_tokens: request.constraints.maxTokens,
      };

      const started = Date.now();
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        throw new Error(`0G çağrısı başarısız: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
      }

      // HAM gövdeyi saklıyoruz: imza sha256(ham gövde) üzerine atılıyor. JSON'u
      // parse edip tekrar stringify etmek anahtar sırasına bağlı kalır ve
      // sağlayıcı alan sırasını değiştirdiği gün sessizce bozulur.
      const rawResponseText = await res.text();
      const completion = JSON.parse(rawResponseText) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: Record<string, number>;
      };
      const output = completion.choices?.[0]?.message?.content ?? '';

      // chatID `completion.id` DEĞİL: imza sunucusu `ZG-Res-Key` başlığındaki
      // kimliği tanıyor, diğerine "chat_id_not_found" diyor.
      const chatId = res.headers.get('ZG-Res-Key') ?? undefined;

      // --- İMZA: ENCLAVE İÇİNDE, iki adımda ---
      let ogSig: string | undefined;
      let ogSigner: string | undefined;
      let ogVerified = false;

      if (chatId) {
        try {
          const sigRes = await fetch(
            `${svc.url}/v1/proxy/signature/${chatId}?model=${svc.model}`,
            { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) },
          );
          if (sigRes.ok) {
            const sig = (await sigRes.json()) as { text: string; signature: string };
            ogSig = sig.signature;

            // (a) gerçek bir TEE bir şey imzalamış mı?
            ogSigner = verifyMessage(sig.text, sig.signature);
            const signerOk = ogSigner.toLowerCase() === expectedSigner.toLowerCase();

            // (b) imzaladığı şey BİZİM yanıtımız mı?
            const digest = createHash('sha256').update(rawResponseText).digest('hex');
            const coversThisResponse = sig.text.split(':').includes(digest);

            ogVerified = signerOk && coversThisResponse;

            if (signerOk && !coversThisResponse) {
              // Geçerli imza + başka yanıt = tam olarak engellemek istediğimiz saldırı.
              throw new Error(
                'GEÇERLİ TEE imzası ama BAŞKA bir yanıta ait — bu yanıtın sha256\'sı demette yok',
              );
            }

            if (ogVerified && options.recordDir) {
              recordRun(options.recordDir, {
                request: { endpoint, model, prompt: buildPrompt(request) },
                rawResponseText,
                output,
                latencyMs,
                chatID: chatId,
                signature: sig,
                verification: { expectedSigner, responseSha256: digest },
                requestKey: computeRequestKey(request),
              });
            }
          }
        } catch (err) {
          // İmza alınamadı ya da tutmadı: `ogVerified` false kalır. Çıktı yine
          // döner çünkü enclave yalan söylemez, EKSİĞİ RAPORLAR (P3-B kuralı).
          ogVerified = false;
          if (err instanceof Error && err.message.startsWith('GEÇERLİ TEE imzası')) throw err;
        }
      }

      return { output, ogSig, ogSigner, ogVerified, provider: '0g-sealed-inference', chatId, latencyMs };
    },
  };
}
