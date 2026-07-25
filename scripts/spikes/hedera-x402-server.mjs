// P0(d) — Hedera x402 resource server.
// Exposes GET /paid-resource: 402s with real payment requirements until a client
// presents a signed Hedera exact-scheme payment, which this server verifies + settles
// against the real blocky402 testnet facilitator (https://api.testnet.blocky402.com).
//
// Uses the @x402/core primitives directly (x402ResourceServer + HTTPFacilitatorClient)
// rather than the framework-specific x402HTTPResourceServer adapter, since this is a
// bare node:http server for the spike.
import http from 'node:http';
import fs from 'node:fs';

import { x402ResourceServer } from '@x402/core/server';
import {
  HTTPFacilitatorClient,
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import {
  Client,
  AccountId,
  PrivateKey,
  AccountCreateTransaction,
  Hbar,
} from '@hiero-ledger/sdk';

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
const RESOURCE_PATH = '/paid-resource';
// 0.01 HBAR, expressed in tinybars (1 HBAR = 10^8 tinybars) per @x402/hedera README.
const PRICE_TINYBARS = '1000000';

// The x402 exact-Hedera facilitator nets transfers per account; a self-pay (payer == payTo)
// nets to zero and the facilitator rejects it as invalid_exact_hedera_payload_amount_mismatch.
// So we need a distinct "seller" recipient account. We create + cache a small throwaway
// testnet account (funded from the operator account) the first time this script runs.
const SELLER_CACHE_PATH = 'scripts/spikes/.hedera-x402-seller.json';

async function getOrCreateSellerAccount() {
  if (fs.existsSync(SELLER_CACHE_PATH)) {
    const cached = JSON.parse(fs.readFileSync(SELLER_CACHE_PATH, 'utf8'));
    console.log('reusing cached seller account:', cached.accountId);
    return cached;
  }
  console.log('no cached seller account — creating a fresh testnet account (funded 2 HBAR)...');
  const operatorId = AccountId.fromString(env.HEDERA_ACCOUNT_ID);
  const operatorKey = PrivateKey.fromStringECDSA(env.HEDERA_PRIVATE_KEY);
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);

  const sellerKey = PrivateKey.generateECDSA();
  const tx = await new AccountCreateTransaction()
    .setKeyWithoutAlias(sellerKey.publicKey)
    .setInitialBalance(new Hbar(2))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const accountId = receipt.accountId.toString();
  client.close();

  const record = { accountId, privateKey: sellerKey.toStringRaw() };
  fs.writeFileSync(SELLER_CACHE_PATH, JSON.stringify(record, null, 2));
  console.log('created seller account:', accountId);
  return record;
}

const seller = await getOrCreateSellerAccount();
const PAY_TO = seller.accountId;

console.log('--- P0(d) Hedera x402 server: setup ---');
console.log({ facilitator: env.X402_FACILITATOR_URL, payTo: PAY_TO, priceTinybars: PRICE_TINYBARS });

const facilitatorClient = new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register('hedera:testnet', new ExactHederaScheme());

await resourceServer.initialize();
console.log('resourceServer initialized against facilitator');

const requirements = await resourceServer.buildPaymentRequirements({
  scheme: 'exact',
  payTo: PAY_TO,
  price: { asset: '0.0.0', amount: PRICE_TINYBARS },
  network: 'hedera:testnet',
  maxTimeoutSeconds: 60,
});
console.log('built payment requirements:', JSON.stringify(requirements, null, 2));

const resourceInfo = {
  url: `http://localhost:${PORT}${RESOURCE_PATH}`,
  description: 'Hedera x402 P0(d) spike resource',
  mimeType: 'application/json',
};

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' || req.url !== RESOURCE_PATH) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  const paymentSignatureHeader =
    req.headers['payment-signature'] || req.headers['PAYMENT-SIGNATURE'];

  if (!paymentSignatureHeader) {
    console.log('[server] no payment presented -> 402');
    const paymentRequired = await resourceServer.createPaymentRequiredResponse(
      requirements,
      resourceInfo
    );
    res.writeHead(402, {
      'Content-Type': 'application/json',
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(paymentRequired),
    });
    res.end(JSON.stringify(paymentRequired));
    return;
  }

  console.log('[server] payment header present -> verify + settle');
  let paymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(String(paymentSignatureHeader));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad payment header', message: e.message }));
    return;
  }

  const matched = resourceServer.findMatchingRequirements(requirements, paymentPayload);
  if (!matched) {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no matching payment requirements' }));
    return;
  }

  const verifyResult = await resourceServer.verifyPayment(paymentPayload, matched);
  console.log('[server] verifyResult:', JSON.stringify(verifyResult));
  if (!verifyResult.isValid) {
    res.writeHead(402, {
      'Content-Type': 'application/json',
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(
        await resourceServer.createPaymentRequiredResponse(
          requirements,
          resourceInfo,
          verifyResult.invalidReason
        )
      ),
    });
    res.end(JSON.stringify({ error: verifyResult.invalidReason, message: verifyResult.invalidMessage }));
    return;
  }

  const settleResult = await resourceServer.settlePayment(paymentPayload, matched);
  console.log('[server] settleResult:', JSON.stringify(settleResult));

  if (!settleResult.success) {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: settleResult.errorReason, message: settleResult.errorMessage }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'PAYMENT-RESPONSE': encodePaymentResponseHeader(settleResult),
  });
  res.end(
    JSON.stringify({
      ok: true,
      message: 'paid resource unlocked',
      settlement: settleResult,
    })
  );
  console.log('[server] 200 OK returned to client');
});

server.listen(PORT, () => {
  console.log(`--- P0(d) Hedera x402 server listening on http://localhost:${PORT}${RESOURCE_PATH} ---`);
});
