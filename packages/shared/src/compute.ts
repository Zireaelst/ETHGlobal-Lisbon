// compute.ts — modelin NEREDE koştuğunu binding mantığından ayıran sınır.
//
// Neden ayrı bir sınır: `runBinding` işin taahhüdünü yeniden hesaplayıp gövdeyi
// imzalıyor; modelin 0G TEE'sinde mi, bir fixture'dan mı, yoksa hiç mi koştuğu onu
// ilgilendirmiyor. Bu sınır sayesinde gerçek 0G backend'i geldiğinde `runBinding`,
// gövde kodlaması, `Verifier.sol`, subgraph ve kapılar DEĞİŞMİYOR — yalnızca
// bob-agent'ın hangi backend'i seçtiği değişiyor.
//
// DÜRÜSTLÜK KURALI (BUILD-PLAN P3-B): `ogVerified` ancak imzayı KENDİMİZ kurtarıp
// broker'ın verdiği `teeSignerAddress` ile eşleştirdiğimizde true olabilir.
// İmza yoksa alan `undefined` kalır — sahte imza ÜRETİLMEZ. `provider` alanı da
// arayüze kadar taşınır ki "0G attestation'ı var mı" sorusu gösterilsin, çıkarsanmasın.

import type { Constraints } from './intent.js';

export interface ComputeRequest {
  brief: string;
  data: string;
  constraints: Constraints;
  /**
   * İstemcinin sipariş taahhüdü (`intentHash`) — LEVEL 0 BAĞLAMA.
   *
   * Verilirse prompt'un başına konur ve modelden çıktısında AYNEN tekrarlaması
   * istenir. Böylece 0G TEE'sinin imzaladığı gövde bu değeri de kapsar:
   *     TEE imzası → yanıt gövdesi → çıktı → intentHash → Alice'in EIP-712 imzası
   * Bob bu zinciri kendi makinesinde üretemez; ilk halka 0G donanımından gelir.
   *
   * NEDEN CLAIMED (iddia edilen) hash: kontrat ve Alice ikisi de bu değere
   * bakıyor. Yeniden hesaplanan hash zaten gövdedeki `match` bayrağıyla
   * raporlanıyor, tekrar taşımanın bilgi katkısı yok.
   *
   * SINIR: bu, "hash gerçekten şu brief+data'ya ait" demek DEĞİL. Model tekrar
   * ediyor, doğrulamıyor. O kontrol hâlâ attested olmayan kodumuzda.
   */
  commitment?: string;
}

/** Çıktıyı kimin ürettiği — kullanıcı arayüzüne kadar taşınan dürüstlük etiketi. */
export type ComputeProvider = 'none' | '0g-sealed-inference' | 'fixture-replay';

export interface ComputeResult {
  /** Modelin ürettiği metin. */
  output: string;
  /**
   * 0G TEE'nin EIP-191 imzası. Yoksa undefined — uydurulmaz.
   *
   * NE KAPSAR (P0-B'de ÖLÇÜLDÜ, CLAUDE.md §3.1 buna göre düzeltildi): imza çıktı
   * metnini DEĞİL, şu demeti kapsıyor:
   *     "<h1>:<sha256(ham yanıt gövdesi)>:<ProviderType>:<ProviderIdentity>:<h3>"
   * Yani çıktı, kendisini içeren gövdenin PARMAK İZİ olarak imza kapsamında.
   * Kurcalamaya karşı garanti aynı; kurulan cümle farklı.
   * `chatId` çıktı↔istek bağını 0G'nin kendi defterinde kurar.
   */
  ogSig?: string;
  /** İmzadan kurtarılan adres — broker'ın `teeSignerAddress`'i ile karşılaştırılır. */
  ogSigner?: string;
  /** İmza ENCLAVE İÇİNDE doğrulandı mı. Doğrulanamadıysa false; sessizce true yazılmaz. */
  ogVerified: boolean;
  provider: ComputeProvider;
  /**
   * `commitment` prompt'a konuldu mu — yani bu çıktının Level 0 bağlaması var mı.
   * Çıktının taahhüdü GERÇEKTEN taşıyıp taşımadığını backend değil, enclave
   * (`runBinding`) kendisi kontrol eder; backend'in dürüstlüğüne bağlı kalmasın.
   */
  commitmentRequested?: boolean;
  /** 0G ledger'ındaki istek kimliği (`processResponse` için). */
  chatId?: string;
  /** P0-G latency bütçesi için ölçüm. */
  latencyMs: number;
}

export interface ComputeBackend {
  readonly provider: ComputeProvider;
  run(request: ComputeRequest): Promise<ComputeResult>;
}

/**
 * 0G erişimi olmadan çalışan backend.
 *
 * Gerçek analiz ÜRETMEZ ve attestation İDDİA ETMEZ: `ogVerified: false`,
 * `provider: 'none'`. Sistem "burada 0G imzası yok" demeyi biliyor — sahte bir
 * TEE imzası üretmektense eksikliği doğru şekilde raporluyor.
 *
 * Gerçek backend (`createZeroGBackend`) 0G token'ı geldiğinde eklenecek; bu
 * arayüzü uygulayacağı için çağıranlarda hiçbir değişiklik gerekmeyecek.
 */
export function createNoComputeBackend(): ComputeBackend {
  return {
    provider: 'none',
    async run(request: ComputeRequest): Promise<ComputeResult> {
      const started = Date.now();
      const output =
        `[compute: none] Brief ${request.brief.length} karakter, veri ${request.data.length} karakter alındı; ` +
        `model "${request.constraints.model}" ile gerçek çıkarım YAPILMADI. ` +
        `0G Sealed Inference bağlanınca bu metnin yerini gerçek analiz ve TEE imzası alacak.`;
      return {
        output,
        ogVerified: false,
        provider: 'none',
        latencyMs: Date.now() - started,
      };
    },
  };
}

/** İnsan okunur özet — kapı çıktıları ve demo paneli için. */
export function describeCompute(result: Pick<ComputeResult, 'provider' | 'ogVerified'>): string {
  switch (result.provider) {
    case '0g-sealed-inference':
      return result.ogVerified ? '0G Sealed Inference · TEE imzası doğrulandı' : '0G Sealed Inference · imza DOĞRULANAMADI';
    case 'fixture-replay':
      return 'kayıtlı 0G yanıtı (fixture replay) · canlı çağrı değil';
    case 'none':
      return '0G bağlı değil · gerçek çıkarım ve TEE imzası YOK';
  }
}
