// signer/hedera-signer.ts — DELEGATED SIGNING sınırı.
//
// BUILD-PLAN P4-C kriteri: "anahtar `signer` modülünde, agent/LLM bağlamına girmiyor"
// ve kapı bunu kanıtlıyor: "agent sürecinin loglarında/bellek dökümünde private key YOK".
//
// Bu modülün tek işi anahtarı SAHİPLENMEK. Dışarı yalnızca imzalama yeteneği çıkıyor:
//
//   - Anahtar env'den BU MODÜL tarafından okunuyor; çağıran onu asla elinde tutmuyor.
//   - Kapanış (closure) içinde kalıyor; handle üzerinde erişimci yok.
//   - `toJSON`/`toString`/`inspect` REDACTED döndürüyor — kazara loglama ya da bir
//     hata nesnesine serileştirme sızdıramıyor.
//
// Hedera'nın kendi kanonik deseni de bu: `Client.setOperatorWith(accountId, publicKey,
// transactionSigner)` ile anahtar bir KMS/HSM'de durur, SDK yalnızca imzalama
// fonksiyonunu çağırır (docs.hedera.com/native/tutorials/advanced/hsm-signing).
// Burada kasa yerel bir kapanış; sınır aynı sınır, ve üretimde `createHederaSigner`'ın
// içi KMS çağrısıyla değiştirilse çağıranların hiçbiri değişmez.

import { createClientHederaSigner, PrivateKey } from '@x402/hedera';
import { Client, PrivateKey as HieroPrivateKey } from '@hiero-ledger/sdk';

const REDACTED = '[REDACTED — delegated signer içinde tutuluyor]';

export interface HederaSignerHandle {
  /** Ödeyen hesap kimliği — bu herkese açık, gizli olan sadece anahtar. */
  readonly accountId: string;
  readonly network: 'hedera:testnet' | 'hedera:mainnet';
  /** @x402/hedera istemci imzalayıcısı. Anahtarı AÇIĞA ÇIKARMAZ. */
  readonly signer: ReturnType<typeof createClientHederaSigner>;
}

export interface HederaSignerOptions {
  /**
   * Anahtarın okunacağı env değişkeni. Anahtarın KENDİSİ parametre olarak
   * KABUL EDİLMİYOR — çağıranın onu eline alması gereken bir yol bilerek yok.
   */
  keyEnvVar?: string;
  accountId: string;
  network?: 'hedera:testnet' | 'hedera:mainnet';
}

/**
 * Delegated imzalayıcı oluştur.
 *
 * @throws anahtar env'de yoksa — sessizce imzasız devam etmez.
 */
export function createHederaSigner(options: HederaSignerOptions): HederaSignerHandle {
  const envVar = options.keyEnvVar ?? 'HEDERA_OPERATOR_KEY';
  const raw = process.env[envVar];
  if (!raw || raw.trim() === '') {
    throw new Error(
      `delegated signer: ${envVar} boş. Anahtar yalnızca bu modül tarafından okunur; ` +
        `çağıran taraf onu geçiremez.`,
    );
  }

  const network = options.network ?? 'hedera:testnet';
  // Anahtar buradan sonra yalnızca kapanışta yaşıyor. Referansı dışarı vermiyoruz.
  const signer = createClientHederaSigner(options.accountId, PrivateKey.fromStringECDSA(raw.trim()), {
    network,
  });

  const handle = {
    accountId: options.accountId,
    network,
    signer,
    // Kazara serileştirme/loglama sızdırmasın diye üç kapı birden.
    toJSON: () => ({ accountId: options.accountId, network, privateKey: REDACTED }),
    toString: () => `HederaSigner(${options.accountId}, key=${REDACTED})`,
    [Symbol.for('nodejs.util.inspect.custom')]: () =>
      `HederaSigner(${options.accountId}, key=${REDACTED})`,
  };

  return handle as HederaSignerHandle;
}

/**
 * HCS yazımı için operatör `Client`'ı — anahtar yine bu modülde kalır.
 *
 * Topic'e mesaj göndermek işlem ücreti gerektiriyor, yani bir operatör anahtarı
 * şart. Onu çağırana geçirmek P4-C'nin delegated-signing sınırını delerdi; bunun
 * yerine yapılandırılmış Client'ı döndürüyoruz. Client anahtarı dışarı vermez.
 */
export function createHederaOperatorClient(options: {
  accountId: string;
  keyEnvVar?: string;
  network?: 'testnet' | 'mainnet';
}): Client {
  const envVar = options.keyEnvVar ?? 'HEDERA_OPERATOR_KEY';
  const raw = process.env[envVar];
  if (!raw || raw.trim() === '') {
    throw new Error(`delegated signer: ${envVar} boş — HCS yazımı için operatör anahtarı gerekli`);
  }
  const client = (options.network ?? 'testnet') === 'testnet' ? Client.forTestnet() : Client.forMainnet();
  client.setOperator(options.accountId, HieroPrivateKey.fromStringECDSA(raw.trim()));
  return client;
}

/** Bir metnin anahtar sızdırıp sızdırmadığını denetlemek için (kapı kullanıyor). */
export function containsSecret(haystack: string, secretEnvVar = 'HEDERA_OPERATOR_KEY'): boolean {
  const secret = process.env[secretEnvVar];
  if (!secret || secret.trim().length < 16) return false;
  const s = secret.trim();
  const candidates = [s, s.startsWith('0x') ? s.slice(2) : `0x${s}`, s.toLowerCase(), s.toUpperCase()];
  return candidates.some((c) => haystack.includes(c));
}

export { REDACTED };
