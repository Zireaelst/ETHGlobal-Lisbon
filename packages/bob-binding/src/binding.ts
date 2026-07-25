// binding.ts — DÜRÜST binding mantığı. Bu dosya enclave'in içinde çalışacak kod.
//
// BUILD-PLAN P1-D'nin can alıcı kuralı: "Enclave'de FRAUD_MODE YOK. Fraud dış katmanda."
// Bu yüzden burada hile anahtarı, ortam değişkeni okuması ya da koşullu davranış YOK.
// Fonksiyon ne aldıysa onu yeniden hesaplar ve sonucu dürüstçe raporlar.
//
// P3-B kuralı burada da geçerli ve kasıtlı: `match === false` olsa bile akış DEVAM EDER
// ve gövde İMZALANIR. Enclave yalan söylemez, sadece raporlar; reddi kontrat verir.
// Fraud demosu tam olarak bu davranışa dayanıyor.
//
// FAZ 1 SINIRI — dürüstlük notu:
//   - Burada 0G Sealed Inference çağrısı YOK; `output` yer tutucu bir metin,
//     `ogSigHash` sıfır. P3-B gerçek çağrıyı ve 0G imza doğrulamasını ekleyecek.
//   - İmza, doğrulanmış Tapp seal formatı DEĞİL: keccak256(body) üzerine düz secp256k1.
//     Gerçek seal preimage'ı P0-C'de kanıtlanacak; kanıtlanmadan o formatı taklit etmek
//     sahip olmadığımız bir güvenceyi varmış gibi gösterirdi.
//   - Bu yüzden imzalayan anahtar "binding key" diye geçiyor, "seal key" değil.

import { AbiCoder, Wallet, keccak256, recoverAddress, toUtf8Bytes } from 'ethers';
import { buildIntentHash, type Constraints } from '@ca/shared';

/** Enclave'e giren iş emri. */
export interface BindingRequest {
  /** İstemcinin taahhüt ettiğini İDDİA ettiği hash — doğrulanacak olan bu. */
  claimedIntentHash: string;
  brief: string;
  data: string;
  constraints: Constraints;
  price: bigint;
  nonce: bigint;
}

/** Enclave'in imzalayıp döndürdüğü sonuç. */
export interface BindingResponse {
  claimedIntentHash: string;
  /** İçerikten YENİDEN hesaplanan taahhüt. */
  recomputedIntentHash: string;
  match: boolean;
  output: string;
  outputHash: string;
  /** P3-B'de keccak256(ogSig) olacak; FAZ 1'de 0G çağrısı yok, sıfır. */
  ogSigHash: string;
  /** İmzalanan ham gövde: abi.encode(bytes32,bytes32,bool,bytes32). */
  bodyHex: string;
  /** keccak256(body) üzerine 65-byte imza. */
  signature: string;
  signer: string;
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

/** Gövdeyi imzalayan adresi kurtar. */
export function recoverBindingSigner(bodyHex: string, signature: string): string {
  return recoverAddress(keccak256(bodyHex), signature);
}

/**
 * Dürüst binding akışı.
 *
 * 1. İçerikten intentHash'i YENİDEN hesapla (iddiaya güvenme)
 * 2. match = (yeniden hesaplanan === iddia edilen)
 * 3. çıktıyı üret (FAZ 1: yer tutucu; P3-B: 0G Sealed Inference)
 * 4. gövdeyi kur ve İMZALA — match false olsa bile
 */
export async function runBinding(request: BindingRequest, bindingKey: string): Promise<BindingResponse> {
  const recomputedIntentHash = buildIntentHash({
    brief: request.brief,
    data: request.data,
    constraints: request.constraints,
    price: request.price,
    nonce: request.nonce,
  });
  const match = recomputedIntentHash === request.claimedIntentHash;

  const output = match
    ? `[FAZ 1 binding] Brief ${request.brief.length} karakter, veri ${request.data.length} karakter işlendi. ` +
      `Gerçek analiz P3-B'de 0G Sealed Inference'tan gelecek.`
    : '[FAZ 1 binding] Yeniden hesaplanan taahhüt istemcinin imzaladığıyla uyuşmuyor — iş sipariş edilen iş değil.';

  const outputHash = keccak256(toUtf8Bytes(output));
  const ogSigHash = ZERO32; // P3-B dolduracak
  const bodyHex = encodeBody(request.claimedIntentHash, outputHash, match, ogSigHash);

  // ÖNEKSİZ ham secp256k1 imza. `wallet.signMessage` EIP-191 öneki ekler; kontrat
  // gövdeyi alanlardan yeniden üretip doğrudan keccak256'sını kurtaracağı için önek
  // istemiyoruz (§3.1(B): seal imzasında da EIP-191 yok).
  const wallet = new Wallet(bindingKey);
  const signature = wallet.signingKey.sign(keccak256(bodyHex)).serialized;

  return {
    claimedIntentHash: request.claimedIntentHash,
    recomputedIntentHash,
    match,
    output,
    outputHash,
    ogSigHash,
    bodyHex,
    signature,
    signer: wallet.address,
  };
}
