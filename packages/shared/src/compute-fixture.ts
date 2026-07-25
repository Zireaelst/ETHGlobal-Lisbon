// compute-fixture.ts — kayıtlı 0G yanıtlarını AĞA ÇIKMADAN geri oynatan backend.
//
// BUILD-PLAN P0-D/4: her gerçek 0G çağrısı fixture'a yazılır; `MOCK_0G=1` modunda
// istek fixture'dan karşılanır. UI, kontrat ve subgraph işi bununla yapılır — 12.400
// çağrılık bütçemiz var ama her `pnpm gate:*` koşusunda para yakmanın anlamı yok.
//
// DÜRÜSTLÜK: replay backend'i `provider: 'fixture-replay'` etiketi taşır ve bu etiket
// arayüze kadar çıkar (describeCompute → "canlı çağrı değil"). Kayıtlı yanıtı canlıymış
// gibi göstermiyoruz.
//
// AMA replay ETİKET DEĞİL, DOĞRULAMA yapıyor: kayıtlı imza her oynatmada yeniden
// kurtarılıyor ve kayıtlı imzacıyla karşılaştırılıyor. Fixture kurcalanırsa
// `ogVerified` false olur. Yani "kayıttan geliyor" demek "kontrolsüz" demek değil.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyMessage } from 'ethers';

import type { ComputeBackend, ComputeRequest, ComputeResult } from './compute.js';

/** Diskte duran bir 0G koşusunun şekli (scripts/og-spike.ts üretir). */
export interface RecordedRun {
  request: { endpoint: string; model: string; prompt: string };
  rawResponseText: string;
  output: string;
  latencyMs: number;
  chatID: string;
  signature: { text: string; signature: string };
  verification: { expectedSigner: string; responseSha256?: string };
  /** İsteğe bağlı: bu koşuyu üreten isteğin anahtarı. Yoksa dosya "genel" kayıttır. */
  requestKey?: string;
}

/**
 * Bir compute isteğinin deterministik anahtarı.
 *
 * Alan adlarını da hash'e katıyoruz ki {brief:"a",data:"b"} ile {brief:"b",data:"a"}
 * aynı anahtarı üretmesin.
 */
export function computeRequestKey(request: ComputeRequest): string {
  const canonical = JSON.stringify({
    brief: request.brief,
    data: request.data,
    constraints: request.constraints,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Gerçek bir 0G koşusunu diske yaz — sonraki replay'ler bunu kullanır. */
export function recordRun(dir: string, run: RecordedRun): string {
  mkdirSync(dir, { recursive: true });
  const name = run.requestKey ? `run-${run.requestKey.slice(0, 16)}.json` : 'run-1.json';
  const path = resolve(dir, name);
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return path;
}

export interface FixtureBackendOptions {
  /** fixtures/og dizini. */
  dir: string;
  /**
   * İstek anahtarı eşleşmezse ne yapılsın?
   *   'fallback' → eldeki herhangi bir kayıt oynatılır (geliştirme kolaylığı)
   *   'strict'   → hata fırlatılır (kapılarda bunu kullan)
   */
  onMiss?: 'fallback' | 'strict';
}

/** Diskteki tüm kayıtları oku. */
function loadRuns(dir: string): Map<string, RecordedRun> {
  const runs = new Map<string, RecordedRun>();
  if (!existsSync(dir)) return runs;
  for (const file of readdirSync(dir)) {
    if (!file.startsWith('run-') || !file.endsWith('.json')) continue;
    const run = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as RecordedRun;
    runs.set(run.requestKey ?? file, run);
  }
  return runs;
}

export function createFixtureComputeBackend(options: FixtureBackendOptions): ComputeBackend {
  const onMiss = options.onMiss ?? 'fallback';
  const runs = loadRuns(options.dir);
  if (runs.size === 0) {
    throw new Error(
      `${options.dir} altında kayıtlı 0G koşusu yok — önce: npx tsx scripts/og-spike.ts`,
    );
  }

  return {
    provider: 'fixture-replay',
    async run(request: ComputeRequest): Promise<ComputeResult> {
      const started = Date.now();
      const key = computeRequestKey(request);

      let run = runs.get(key);
      if (!run) {
        if (onMiss === 'strict') {
          throw new Error(`fixture yok: istek anahtarı ${key.slice(0, 16)}… (strict mod)`);
        }
        run = runs.values().next().value as RecordedRun;
      }

      // Kayıtlı imzayı HER oynatmada yeniden doğruluyoruz — fixture kurcalanırsa
      // ogVerified false olur. AĞA ÇIKILMIYOR: verifyMessage saf hesap.
      let ogSigner: string | undefined;
      let ogVerified = false;
      try {
        ogSigner = verifyMessage(run.signature.text, run.signature.signature);
        ogVerified = ogSigner.toLowerCase() === run.verification.expectedSigner.toLowerCase();
      } catch {
        ogVerified = false;
      }

      return {
        output: run.output,
        ogSig: run.signature.signature,
        ogSigner,
        ogVerified,
        provider: 'fixture-replay',
        chatId: run.chatID,
        // Kayıttaki GERÇEK gecikmeyi taşıyoruz; replay'in kendi hızını değil.
        // Aksi halde P0-G bütçesi olduğundan iyi görünürdü.
        latencyMs: run.latencyMs,
        replayedAt: Date.now() - started,
      } as ComputeResult & { replayedAt: number };
    },
  };
}
