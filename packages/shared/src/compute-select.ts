// compute-select.ts — hangi compute backend'inin kullanılacağına ortamdan karar ver.
//
// Üç mod var ve ÜÇÜ DE kendini doğru etiketliyor (`ComputeProvider` arayüze kadar çıkar):
//
//   REPLAY_0G=1   → 'fixture-replay'      kayıtlı GERÇEK çağrı tekrar oynatılır, ağa çıkılmaz
//   0G anahtarı   → '0g-sealed-inference' canlı TEE çağrısı
//   ikisi de yok  → 'none'                hiç çıkarım yok; sahte çıktı ÜRETİLMEZ
//
// İSİMLENDİRME NOTU: BUILD-PLAN bu bayrağa `MOCK_0G` diyor ve isim yanıltıcı —
// "uydur" çağrıştırıyor, oysa yaptığı şey GERÇEK bir çağrının kaydını oynatmak.
// Fixture'daki imza 0G TEE'sinin gerçekten attığı imzadır ve her oynatmada
// yeniden doğrulanır. Bu yüzden `REPLAY_0G` birincil isim; `MOCK_0G` geriye
// dönük olarak kabul ediliyor ki plandaki ve .env'deki mevcut kullanım kırılmasın.

import type { ComputeBackend } from './compute.js';
import { createNoComputeBackend } from './compute.js';

export interface ComputeSelectionEnv {
  REPLAY_0G?: string;
  /** @deprecated `REPLAY_0G` kullan — bu isim "uydurma veri" çağrıştırıyor. */
  MOCK_0G?: string;
  OG_RPC_URL?: string;
  OG_PRIVATE_KEY?: string;
  OG_PROVIDER_ADDRESS?: string;
}

export interface ComputeSelectionOptions {
  /** Fixture dizini (replay modu için). */
  fixtureDir: string;
  /** Canlı çağrıları buraya kaydet. Boşsa kayıt yapılmaz. */
  recordDir?: string;
}

const isOn = (v: string | undefined): boolean => v === '1' || v === 'true';

/** Seçimin gerekçesini de döndürür — kapılar ve demo bunu basar. */
export async function selectComputeBackend(
  env: ComputeSelectionEnv,
  options: ComputeSelectionOptions,
): Promise<{ backend: ComputeBackend; reason: string }> {
  if (isOn(env.REPLAY_0G) || isOn(env.MOCK_0G)) {
    const { createFixtureComputeBackend } = await import('./compute-fixture.js');
    const flag = isOn(env.REPLAY_0G) ? 'REPLAY_0G' : 'MOCK_0G (eski ad)';
    return {
      backend: createFixtureComputeBackend({ dir: options.fixtureDir }),
      reason: `${flag}=1 → kayıtlı gerçek 0G yanıtı oynatılıyor, ağa çıkılmıyor`,
    };
  }

  if (env.OG_RPC_URL && env.OG_PRIVATE_KEY) {
    const { createZeroGComputeBackend } = await import('./compute-0g.js');
    return {
      backend: createZeroGComputeBackend({
        rpcUrl: env.OG_RPC_URL,
        privateKey: env.OG_PRIVATE_KEY,
        providerAddress: env.OG_PROVIDER_ADDRESS || undefined,
        recordDir: options.recordDir,
      }),
      reason: '0G anahtarı mevcut → canlı Sealed Inference',
    };
  }

  return {
    backend: createNoComputeBackend(),
    reason: '0G anahtarı yok ve replay kapalı → çıkarım YOK (sahte çıktı üretilmiyor)',
  };
}
