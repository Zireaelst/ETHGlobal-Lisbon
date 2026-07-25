// P0(d) — Hedera x402 client/payer.
// Hits the local resource server, receives 402, builds + signs a real Hedera
// exact-scheme payment with the funded testnet account, retries, and expects 200
// after the server settles via the real blocky402 testnet facilitator.
import fs from 'node:fs';

import { x402Client } from '@x402/core/client';
import { encodePaymentSignatureHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { createClientHederaSigner, PrivateKey } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).split('#')[0].trim()];
    })
);

const PORT = Number(process.env.HEDERA_X402_PORT || 8402);
const URL = `http://localhost:${PORT}/paid-resource`;

console.log('--- P0(d) Hedera x402 client: setup ---');
console.log({ accountId: env.HEDERA_OPERATOR_ID, network: env.HEDERA_NETWORK, url: URL });

const signer = createClientHederaSigner(
  env.HEDERA_OPERATOR_ID,
  PrivateKey.fromStringECDSA(env.HEDERA_OPERATOR_KEY),
  { network: 'hedera:testnet' }
);

const client = new x402Client().register('hedera:*', new ExactHederaScheme(signer));

console.log('--- step 1: initial request (expect 402) ---');
const res1 = await fetch(URL);
console.log('status:', res1.status);

if (res1.status !== 402) {
  const body = await res1.text().catch(() => '');
  throw new Error(`Expected 402 on first request, got ${res1.status}: ${body}`);
}

const paymentRequiredHeader = res1.headers.get('PAYMENT-REQUIRED') || res1.headers.get('payment-required');
if (!paymentRequiredHeader) {
  throw new Error('402 response missing PAYMENT-REQUIRED header');
}
const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
console.log('paymentRequired.accepts:', JSON.stringify(paymentRequired.accepts, null, 2));

console.log('--- step 2: build + sign payment payload (real Hedera testnet tx) ---');
const paymentPayload = await client.createPaymentPayload(paymentRequired);
console.log('paymentPayload (accepted requirement):', JSON.stringify(paymentPayload.accepted, null, 2));

const paymentSignatureHeader = encodePaymentSignatureHeader(paymentPayload);

console.log('--- step 3: retry request with PAYMENT-SIGNATURE header (expect 200 after facilitator settlement) ---');
const t0 = Date.now();
const res2 = await fetch(URL, {
  headers: { 'PAYMENT-SIGNATURE': paymentSignatureHeader },
});
const elapsedMs = Date.now() - t0;
console.log('status:', res2.status, `(${elapsedMs}ms)`);

const body2 = await res2.json();
console.log('body:', JSON.stringify(body2, null, 2));

if (res2.status !== 200) {
  throw new Error(`Expected 200 after payment, got ${res2.status}`);
}

const paymentResponseHeader = res2.headers.get('PAYMENT-RESPONSE') || res2.headers.get('payment-response');
const settleResponse = paymentResponseHeader ? decodePaymentResponseHeader(paymentResponseHeader) : body2.settlement;
console.log('--- settlement result ---');
console.log(JSON.stringify(settleResponse, null, 2));

console.log('--- DONE P0(d): 402 -> pay -> 200 round trip', res2.status === 200 ? 'SUCCEEDED' : 'FAILED', '---');
