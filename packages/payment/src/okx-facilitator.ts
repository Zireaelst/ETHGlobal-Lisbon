// okx-facilitator.ts — OKX's x402 facilitator, as a `FacilitatorClient`.
//
// The X Layer rail needs a facilitator that settles `eip155:1952`, and OKX's is the one that
// does. blocky402 (our Hedera rail) covers `hedera:testnet` and does not know X Layer, so the
// two rails run side by side behind two facilitators rather than one.
//
// WHY THIS IS HAND-WRITTEN RATHER THAN `HTTPFacilitatorClient` + auth headers.
// `@x402/core` exposes a `createAuthHeaders` hook, but OKX signs
// `timestamp + method + path + body` and that hook is called with NO ARGUMENTS — it cannot
// see the body it would have to sign. The interface it would implement is three methods, so
// implementing it directly is both smaller and honest about what it does.
//
// WHY NOT `@okxweb3/app-x402-core`. OKX publishes its own port of this SDK, whose
// `OKXFacilitatorClient` does exactly this. Adopting it would mean a second, parallel
// `x402ResourceServer` at version 0.2.x alongside the 2.19.0 one the Hedera rail already
// runs on — two resource servers, or a migration of a working rail onto an early fork.
// Talking to the same HTTP API directly costs ~120 lines and adds no dependency.
//
// Wire format read from OKX's own client:
//   okx/payments (branch `master`) → typescript/bu-payments/app-x402-core/src/facilitator/OKXFacilitatorClient.ts
//
// TESTNET IS REAL, and this is the point of the whole rail. An earlier reading of OKX's
// TypeScript `SELLER.md` ("X Layer only — no other networks") was taken to mean mainnet-only;
// it means "not Base, not Solana". OKX's own live mock merchant answers on `eip155:1952`:
//   curl https://www.okx.com/api/v1/pay/mock-merchant/resource
//     → accepts[].network = "eip155:1952"   (verified 2026-08-20)
// So this rail settles through OKX's real facilitator and the project stays 100% testnet.

import { createHmac } from 'node:crypto';
import type { FacilitatorClient } from '@x402/core/server';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types';

/** Every OKX REST response is wrapped in this envelope. */
interface OkxEnvelope<T> {
  code?: string | number;
  msg?: string;
  data?: T;
}

export interface OkxFacilitatorConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  /** Defaults to OKX's production host, which also serves the testnet networks. */
  baseUrl?: string;
  /**
   * Wait for on-chain confirmation before returning from `settle`.
   *
   * ON by default here, and the reason is the whole thesis: settlement is the LAST step, it
   * happens only after `JobVerified`, and the demo's strongest sentence is "the payment never
   * settled". A receipt reporting `pending` would make that sentence unprovable at the moment
   * we need to print it.
   */
  syncSettle?: boolean;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://web3.okx.com';
const DEFAULT_TIMEOUT_MS = 60_000;

const SUPPORTED_PATH = '/api/v6/pay/x402/supported';
const VERIFY_PATH = '/api/v6/pay/x402/verify';
const SETTLE_PATH = '/api/v6/pay/x402/settle';

export class OkxFacilitatorClient implements FacilitatorClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly syncSettle: boolean;

  constructor(private readonly config: OkxFacilitatorConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.syncSettle = config.syncSettle ?? true;
  }

  /**
   * OKX REST auth: HMAC-SHA256 over `timestamp + method + path + body`, base64.
   *
   * The body must be the EXACT string that goes on the wire — re-serialising it anywhere
   * between here and `fetch` changes the bytes and invalidates the signature. That is why the
   * caller passes an already-stringified body rather than an object.
   */
  private headers(method: string, path: string, body?: string): Record<string, string> {
    const timestamp = new Date().toISOString();
    const sign = createHmac('sha256', this.config.secretKey)
      .update(timestamp + method + path + (body ?? ''))
      .digest('base64');

    return {
      'OK-ACCESS-KEY': this.config.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.config.passphrase,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers: this.headers(method, path, body),
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`OKX facilitator ${path} unreachable: ${String(error).slice(0, 160)}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OKX facilitator ${path} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
    }

    let parsed: OkxEnvelope<T>;
    try {
      parsed = JSON.parse(text) as OkxEnvelope<T>;
    } catch {
      throw new Error(`OKX facilitator ${path} returned non-JSON: ${text.slice(0, 240)}`);
    }

    // A non-zero `code` is an application-level failure even on HTTP 200. Reporting it as
    // success would let an unpaid request buy work.
    if (parsed.code !== undefined && String(parsed.code) !== '0') {
      throw new Error(
        `OKX facilitator ${path} rejected the request: code ${parsed.code} ${parsed.msg ?? ''}`.trim(),
      );
    }

    return (parsed.data ?? (parsed as unknown)) as T;
  }

  async getSupported(): Promise<SupportedResponse> {
    return this.request<SupportedResponse>('GET', SUPPORTED_PATH);
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.request<VerifyResponse>('POST', VERIFY_PATH, {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    });
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.request<SettleResponse>('POST', SETTLE_PATH, {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
      syncSettle: this.syncSettle,
    });
  }
}

/**
 * Build the client from the environment, or `undefined` when credentials are absent.
 *
 * `undefined` rather than a throw: no OKX key means "run the other two rails", which is a
 * supported configuration and the default one. The gates run without OKX credentials.
 */
export function createOkxFacilitatorFromEnv(env: NodeJS.ProcessEnv = process.env): OkxFacilitatorClient | undefined {
  // Trimmed because a stray space or newline around a credential yields a 401 that reads like
  // a wrong key rather than a formatting slip.
  //
  // A related `.env` trap this cannot fix: dotenv treats an unquoted `#` as a comment, so a
  // passphrase containing one arrives silently truncated. Quote it in `.env`.
  const apiKey = env.OKX_API_KEY?.trim();
  const secretKey = env.OKX_SECRET_KEY?.trim();
  const passphrase = env.OKX_PASSPHRASE?.trim();

  if (!apiKey || !secretKey || !passphrase) return undefined;

  return new OkxFacilitatorClient({
    apiKey,
    secretKey,
    passphrase,
    ...(env.OKX_BASE_URL?.trim() ? { baseUrl: env.OKX_BASE_URL.trim() } : {}),
  });
}
