// P0(a) — one 0G Sealed Inference call + processResponse verify + capture teeSignerAddress.
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).split('#')[0].trim()];
    })
);

const PROVIDER = '0xa48f01287233509FD694a22Bf840225062E67836'; // chatbot, TeeML, qwen2.5-omni-7b

const provider = new ethers.JsonRpcProvider(env.ZG_RPC_URL);
const wallet = new ethers.Wallet(env.ALICE_PRIVATE_KEY, provider);
const broker = await createZGComputeNetworkBroker(wallet);

console.log('--- account / funding ---');
const ledgerInfo = await broker.ledger.getLedger().catch(() => null);
console.log('ledger before:', ledgerInfo);

// Fund main account a small amount for the spike (0.01 OG).
try {
  await broker.ledger.depositFund(0.01);
  console.log('deposited 0.01 OG to main account');
} catch (e) {
  console.log('deposit skipped/failed:', e.message);
}

console.log('--- provider signer status ---');
const status = await broker.inference.checkProviderSignerStatus(PROVIDER);
console.log(status);

if (!status.isAcknowledged) {
  console.log('acknowledging provider signer...');
  await broker.inference.acknowledgeProviderSigner(PROVIDER);
}

console.log('--- service metadata ---');
const { endpoint, model } = await broker.inference.getServiceMetadata(PROVIDER);
console.log({ endpoint, model });

console.log('--- request headers + chat completion ---');
const content = 'Say the single word: PONG';
const headers = await broker.inference.getRequestHeaders(PROVIDER, content);

const res = await fetch(`${endpoint}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
});

const completion = await res.json();
console.log('completion status:', res.status);
console.log('completion body:', JSON.stringify(completion, null, 2));

const chatID = res.headers.get('ZG-Res-Key') || completion.id;
const outputText = completion.choices?.[0]?.message?.content ?? '';
console.log('chatID:', chatID);
console.log('outputText:', outputText);

console.log('--- processResponse verify ---');
const usage = completion.usage ? JSON.stringify(completion.usage) : '';
const isValid = await broker.inference.processResponse(PROVIDER, chatID, usage);
console.log('processResponse valid:', isValid);

console.log('--- independent signature verification ---');
try {
  const sigLink = await broker.inference.getChatSignatureDownloadLink(PROVIDER, chatID);
  console.log('signature download link:', sigLink);
  const sigRes = await fetch(sigLink);
  const sigBody = await sigRes.text();
  console.log('signature body (raw):', sigBody);

  let signature = sigBody.trim();
  try {
    const parsed = JSON.parse(sigBody);
    signature = parsed.signature ?? parsed.sig ?? signature;
  } catch {
    // not JSON, use raw
  }

  const messageHash = ethers.hashMessage(outputText);
  const recovered = ethers.recoverAddress(messageHash, signature);
  console.log('recovered teeSignerAddress:', recovered);
  console.log('matches status.teeSignerAddress:', recovered.toLowerCase() === status.teeSignerAddress.toLowerCase());
} catch (e) {
  console.log('signature download/verify failed:', e.message);
}

console.log('--- DONE P0(a) ---');
