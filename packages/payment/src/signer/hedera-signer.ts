// signer/hedera-signer.ts — the DELEGATED SIGNING boundary.
//
// BUILD-PLAN P4-C criterion: "the key lives in the `signer` module and never enters agent/LLM
// context", and the gate proves it: "NO private key in the agent process's logs or memory dump".
//
// This module's only job is to OWN the key. Only the ability to sign leaves it:
//
//   - The key is read from the env BY THIS MODULE; the caller never holds it.
//   - It stays inside a closure; the handle exposes no accessor.
//   - `toJSON`/`toString`/`inspect` return REDACTED — accidental logging or serialisation
//     into an error object cannot leak it.
//
// This is also Hedera's own canonical pattern: with `Client.setOperatorWith(accountId,
// publicKey, transactionSigner)` the key sits in a KMS/HSM and the SDK only calls the signing
// function (docs.hedera.com/native/tutorials/advanced/hsm-signing).
// Here the vault is a local closure; the boundary is the same boundary, and if in production
// the inside of `createHederaSigner` were swapped for a KMS call, no caller would change.

import { createClientHederaSigner, PrivateKey } from '@x402/hedera';
import { Client, PrivateKey as HieroPrivateKey } from '@hiero-ledger/sdk';

const REDACTED = '[REDACTED — held inside the delegated signer]';

export interface HederaSignerHandle {
  /** The paying account id — this is public; only the key is secret. */
  readonly accountId: string;
  readonly network: 'hedera:testnet' | 'hedera:mainnet';
  /** The @x402/hedera client signer. It NEVER EXPOSES the key. */
  readonly signer: ReturnType<typeof createClientHederaSigner>;
}

export interface HederaSignerOptions {
  /**
   * The env variable the key is read from. The key ITSELF is NOT ACCEPTED as a parameter —
   * there is deliberately no path that requires the caller to hold it.
   */
  keyEnvVar?: string;
  accountId: string;
  network?: 'hedera:testnet' | 'hedera:mainnet';
}

/**
 * Create the delegated signer.
 *
 * @throws when the key is absent from the env — it does not silently continue unsigned.
 */
export function createHederaSigner(options: HederaSignerOptions): HederaSignerHandle {
  const envVar = options.keyEnvVar ?? 'HEDERA_OPERATOR_KEY';
  const raw = process.env[envVar];
  if (!raw || raw.trim() === '') {
    throw new Error(
      `delegated signer: ${envVar} is empty. The key is read only by this module; ` +
        `the caller cannot pass it in.`,
    );
  }

  const network = options.network ?? 'hedera:testnet';
  // From here on the key lives only in the closure. We never hand out a reference.
  const signer = createClientHederaSigner(options.accountId, PrivateKey.fromStringECDSA(raw.trim()), {
    network,
  });

  const handle = {
    accountId: options.accountId,
    network,
    signer,
    // Three doors at once, so accidental serialisation/logging cannot leak it.
    toJSON: () => ({ accountId: options.accountId, network, privateKey: REDACTED }),
    toString: () => `HederaSigner(${options.accountId}, key=${REDACTED})`,
    [Symbol.for('nodejs.util.inspect.custom')]: () =>
      `HederaSigner(${options.accountId}, key=${REDACTED})`,
  };

  return handle as HederaSignerHandle;
}

/**
 * The operator `Client` for HCS writes — the key again stays inside this module.
 *
 * Submitting a message to a topic costs a transaction fee, so an operator key is required.
 * Passing it to the caller would puncture P4-C's delegated-signing boundary; instead we return
 * the configured Client. The Client does not hand the key out.
 */
export function createHederaOperatorClient(options: {
  accountId: string;
  keyEnvVar?: string;
  network?: 'testnet' | 'mainnet';
}): Client {
  const envVar = options.keyEnvVar ?? 'HEDERA_OPERATOR_KEY';
  const raw = process.env[envVar];
  if (!raw || raw.trim() === '') {
    throw new Error(`delegated signer: ${envVar} is empty — an operator key is required for HCS writes`);
  }
  const client = (options.network ?? 'testnet') === 'testnet' ? Client.forTestnet() : Client.forMainnet();
  client.setOperator(options.accountId, HieroPrivateKey.fromStringECDSA(raw.trim()));
  return client;
}

/** For auditing whether a piece of text leaks the key (used by the gate). */
export function containsSecret(haystack: string, secretEnvVar = 'HEDERA_OPERATOR_KEY'): boolean {
  const secret = process.env[secretEnvVar];
  if (!secret || secret.trim().length < 16) return false;
  const s = secret.trim();
  const candidates = [s, s.startsWith('0x') ? s.slice(2) : `0x${s}`, s.toLowerCase(), s.toUpperCase()];
  return candidates.some((c) => haystack.includes(c));
}

export { REDACTED };
