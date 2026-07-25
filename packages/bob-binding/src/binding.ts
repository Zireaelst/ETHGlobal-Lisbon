// binding.ts — DÜRÜST binding mantığı. Bu dosya enclave'in içinde çalışacak kod.
//
// İKİ SINIR birden burada:
//
// 1. BÜTÜNLÜK (P1-D): "Enclave'de FRAUD_MODE YOK. Fraud dış katmanda." Burada hile
//    anahtarı, ortam değişkeni okuması ya da koşullu davranış yok. Ne aldıysa onu
//    yeniden hesaplar ve dürüstçe raporlar.
//
// 2. GİZLİLİK (CLAUDE.md §2): ECIES çözümü BURADA. Dış katman (bob-agent) paketi
//    ÇÖZEMEZ — anahtarı yok, eline yalnızca ciphertext geçer. "Altyapı veriyi
//    göremez" iddiası ancak böyle doğru olur.
//
//    Dış katmana geri dönen şey de bilerek dar: gövde, seal, ve zincire zaten
//    çıkacak alanlar. `brief`, `data` ve `output` DIŞARI ÇIKMAZ — sonuç doğrudan
//    Alice'in anahtarına şifrelenip öyle teslim edilir.
//
// P3-B kuralı geçerli ve kasıtlı: `match === false` olsa bile akış DEVAM EDER ve
// gövde İMZALANIR. Enclave yalan söylemez, sadece raporlar; reddi kontrat verir.
//
// FAZ 1 SINIRI — dürüstlük notu:
//   - Burada 0G Sealed Inference çağrısı YOK; çıktı `compute.ts` sınırından gelir ve
//     0G bağlı değilken yer tutucudur, `ogSigHash` sıfır kalır.
//   - İmza formatı CLAUDE.md §3.1(B) seal formatı ama imzalayan anahtar attested
//     enclave seal key'i DEĞİL, yerel bir binding anahtarı (P3-C değiştirecek).

import { AbiCoder, Wallet, keccak256, recoverAddress, toUtf8Bytes } from 'ethers';
import {
  TaskEnvelopeSchema,
  buildIntentHash,
  createNoComputeBackend,
  decryptWith,
  eciesPublicKeyOf,
  encryptFor,
  parseOrThrow,
  recoverIntentSigner,
  recoverSealCandidates,
  signSeal,
  verifySeal,
  type ComputeBackend,
  type ComputeProvider,
  type Constraints,
  type EchoResult,
  type SealFields,
  type SealSignature,
} from '@ca/shared';

/** Enclave'e giren iş emri — İÇERİK DEĞİL, ŞİFRELİ PAKET. */
export interface BindingRequest {
  /** Alice'in ECIES ile şifrelediği paket. Enclave dışında çözülmez. */
  cipher: string;
  /** Seal preimage'ının ilk alanı — wrapper'ın agent kimliği (ERC-8004 agentId'si DEĞİL). */
  agentId: string;
  /** Konteyner ömrü başına bir kez üretilen seal kimliği. */
  sealId: string;
  /** Ondalık saniye. */
  timestamp: string;
  /** EIP-712 domain — Alice'in imzasını enclave İÇİNDE doğrulamak için. */
  verifyingContract: string;
  chainId?: number;
}

/** Enclave'in sahip olduğu anahtarlar. İkisi de dış katmana verilmez. */
export interface EnclaveKeys {
  /** Paketi ÇÖZEN anahtar. Kart'ta duyurulan pubkey bunun eşi. */
  ecies: string;
  /** Gövdeyi imzalayan binding/seal anahtarı. */
  binding: string;
}

/**
 * Enclave'in dış katmana döndürdüğü şey.
 *
 * BİLEREK DAR: hepsi ya zincire çıkacak ya da gizli olmayan alanlar. `brief`,
 * `data`, `output` burada YOK — onlar `resultCipher` içinde, Alice'in anahtarıyla.
 */
export interface BindingResponse {
  /** İstemcinin paket içinde taahhüt ettiği hash. */
  claimedIntentHash: string;
  /** İçerikten YENİDEN hesaplanan taahhüt. */
  recomputedIntentHash: string;
  match: boolean;
  outputHash: string;
  /** keccak256(ogSig) — 0G imzası yoksa sıfır (uydurulmuş taahhüt yazılmaz). */
  ogSigHash: string;
  ogSig?: string;
  ogSigner?: string;
  ogVerified: boolean;
  computeProvider: ComputeProvider;
  computeLatencyMs: number;
  /** Çıktı Alice'in `intentHash`'ini birebir taşıyor mu (Level 0 bağlama). */
  intentEchoed: boolean;
  /** İmzalanan ham gövde: abi.encode(bytes32,bytes32,bool,bytes32). */
  bodyHex: string;
  /** Seal imzası — `v` wrapper gibi atılmış (CLAUDE.md §3.1B). */
  seal: SealSignature;
  signer: string;
  /** Alice'in EIP-712 imzasından kurtarılan adres (enclave İÇİNDE doğrulandı). */
  recoveredClient: string;
  clientSigOk: boolean;
  /** Alice'in `replyPubKey`'ine şifrelenmiş sonuç. Dış katman bunu çözemez. */
  resultCipher: string;
}

const ZERO32 = `0x${'00'.repeat(32)}`;

/** §2.3: gövde JSON DEĞİL — kontrat alanlardan yeniden üretebilsin diye abi.encode. */
export function encodeBody(intentHash: string, outputHash: string, match: boolean, ogSigHash: string): string {
  return AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes32', 'bool', 'bytes32'],
    [intentHash, outputHash, match, ogSigHash],
  );
}

export function decodeBody(bodyHex: string): {
  intentHash: string;
  outputHash: string;
  match: boolean;
  ogSigHash: string;
} {
  const decoded = AbiCoder.defaultAbiCoder().decode(['bytes32', 'bytes32', 'bool', 'bytes32'], bodyHex);
  return {
    intentHash: decoded[0] as string,
    outputHash: decoded[1] as string,
    match: decoded[2] as boolean,
    ogSigHash: decoded[3] as string,
  };
}

/**
 * Gövdeyi imzalayan adresi kurtar (`v` brute-force).
 *
 * Beklenen adres verilirse ona eşleşen adayı döndürür; verilmezse ilk adayı.
 * Wrapper `v`'yi attığı için tek bir "doğru" cevap yoktur.
 */
export function recoverBindingSigner(bodyHex: string, seal: SealSignature, expectedSigner?: string): string {
  const candidates = recoverSealCandidates(seal, bodyHex, seal.r, seal.s);
  if (expectedSigner) {
    const want = expectedSigner.toLowerCase();
    const hit = candidates.find((c) => c.address.toLowerCase() === want);
    if (hit) return hit.address;
  }
  return candidates[0]?.address ?? '0x0000000000000000000000000000000000000000';
}

/** Enclave'in duyurduğu ECIES public key — Alice bununla şifreler. */
export function enclavePublicKey(keys: Pick<EnclaveKeys, 'ecies'>): string {
  return eciesPublicKeyOf(keys.ecies);
}

export interface RunBindingOptions {
  compute?: ComputeBackend;
  /**
   * Test kancası: enclave'in ÇÖZDÜĞÜ düz metin.
   *
   * Enclave İÇİNDE çalışır; dış katmana hiçbir şey sızdırmaz. Kapı testleri
   * "paket doğru çözüldü mü"yu görebilsin diye var.
   */
  onDecrypted?: (envelope: { brief: string; data: string; nonce: string }) => void;
}

/**
 * Dürüst binding akışı — ARTIK ÇÖZME DE BURADA.
 *
 * 1. Paketi ÇÖZ (dış katman bunu yapamaz)
 * 2. Şemadan geçir
 * 3. İçerikten intentHash'i YENİDEN hesapla → match
 * 4. Alice'in EIP-712 imzasını doğrula (bilgilendirme; asıl karar kontratta)
 * 5. Modeli çağır (compute sınırı)
 * 6. Gövdeyi kur ve İMZALA — match false olsa bile
 * 7. Sonucu ALICE'İN anahtarına şifrele
 */
export async function runBinding(
  request: BindingRequest,
  keys: EnclaveKeys,
  options: RunBindingOptions = {},
): Promise<BindingResponse> {
  const compute = options.compute ?? createNoComputeBackend();

  // 1-2. ÇÖZ ve doğrula. Bozuk paket burada patlar; dış katman içeriği hiç görmez.
  const decrypted = await decryptWith(keys.ecies, request.cipher);
  const envelope = parseOrThrow(TaskEnvelopeSchema, decrypted, 'TaskEnvelope');
  options.onDecrypted?.({ brief: envelope.brief, data: envelope.data, nonce: envelope.nonce });

  // 3. Taahhüdü İDDİADAN değil, GELEN İÇERİKTEN yeniden hesapla.
  const claimedIntentHash = envelope.intent.intentHash;
  const recomputedIntentHash = buildIntentHash({
    brief: envelope.brief,
    data: envelope.data,
    constraints: envelope.constraints as Constraints,
    price: BigInt(envelope.intent.price),
    nonce: BigInt(envelope.nonce),
  });
  const match = recomputedIntentHash === claimedIntentHash;

  // 4. Alice gerçekten bunu mu imzaladı? Nihai kararı kontrat verir.
  let recoveredClient = '0x0000000000000000000000000000000000000000';
  let clientSigOk = false;
  try {
    recoveredClient = recoverIntentSigner(
      {
        intentHash: claimedIntentHash,
        client: envelope.intent.client,
        agentId: envelope.intent.agentId,
        price: BigInt(envelope.intent.price),
        deadline: BigInt(envelope.intent.deadline),
      },
      envelope.aliceSig,
      request.verifyingContract,
      request.chainId,
    );
    clientSigOk = recoveredClient.toLowerCase() === envelope.intent.client.toLowerCase();
  } catch {
    clientSigOk = false;
  }

  // 5. Modeli çağır. `match === false` olsa BİLE çağrılır ve sonuç imzalanır —
  //    enclave yalan söylemez, sadece raporlar.
  const computed = await compute.run({
    brief: envelope.brief,
    data: envelope.data,
    constraints: envelope.constraints as Constraints,
    // LEVEL 0 BAĞLAMA: taahhüdü modele taşıt. Kendi attested makinemiz olmadığı
    // için bağlamanın bir ucunu 0G'nin GERÇEK enclave'inin içinden geçiriyoruz.
    commitment: claimedIntentHash,
  });

  // Taahhüt gerçekten çıktıda mı? Bu kontrolü BACKEND'E BIRAKMIYORUZ — backend
  // "koydum" diyebilir. Enclave ham çıktıya kendisi bakıyor.
  //
  // Birebir arıyoruz: 64 haneli hex'te tek karakter kayması bağlamayı çökertir,
  // "yaklaşık geçiyor" diye bir şey yok.
  const intentEchoed = computed.output.includes(claimedIntentHash);

  const output = match
    ? computed.output
    : `[binding] Yeniden hesaplanan taahhüt istemcinin imzaladığıyla uyuşmuyor — ` +
      `iş sipariş edilen iş değil. (compute: ${computed.provider})`;

  const outputHash = keccak256(toUtf8Bytes(output));
  const ogSigHash = computed.ogSig ? keccak256(computed.ogSig) : ZERO32;
  const bodyHex = encodeBody(claimedIntentHash, outputHash, match, ogSigHash);

  // 6. Seal formatında imzala. `v` bilerek atılıyor; kontrat 27/28'i kendisi dener.
  const wallet = new Wallet(keys.binding);
  const fields: SealFields = {
    agentId: request.agentId,
    sealId: request.sealId,
    timestamp: request.timestamp,
  };
  const seal = signSeal(fields, bodyHex, keys.binding);

  const bindingSigner = recoverBindingSigner(bodyHex, seal, wallet.address);
  const result: EchoResult = {
    v: 1,
    stage: 'echo',
    intentHash: claimedIntentHash,
    recomputedIntentHash,
    match,
    clientSigOk,
    recoveredClient,
    output,
    bodyHex,
    seal,
    bindingSigner,
    expectedBindingSigner: wallet.address,
    bindingSigOk: bindingSigner.toLowerCase() === wallet.address.toLowerCase(),
    computeProvider: computed.provider,
    ogVerified: computed.ogVerified,
    ogSig: computed.ogSig,
    ogSigner: computed.ogSigner,
    intentEchoed,
  };

  // 7. Sonucu ALICE'İN anahtarına şifrele. Paketin İÇİNDEKİ replyPubKey kullanılır —
  //    dış katmanın tel üzerinde ilettiği kopya değil (o kurcalanabilir).
  const resultCipher = await encryptFor(envelope.replyPubKey, result);

  return {
    claimedIntentHash,
    recomputedIntentHash,
    match,
    outputHash,
    ogSigHash,
    ogSig: computed.ogSig,
    ogSigner: computed.ogSigner,
    ogVerified: computed.ogVerified,
    computeProvider: computed.provider,
    computeLatencyMs: computed.latencyMs,
    intentEchoed,
    bodyHex,
    seal,
    signer: wallet.address,
    recoveredClient,
    clientSigOk,
    resultCipher,
  };
}

/** Enclave'in kendi imzasını doğruladığını gösteren yardımcı (testler için). */
export function selfCheckSeal(response: BindingResponse): boolean {
  return verifySeal(response.seal, response.bodyHex, response.signer);
}

export { recoverAddress };
