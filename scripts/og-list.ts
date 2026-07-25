// scripts/og-list.ts — 0G Compute discovery (READ-ONLY, spends no money).
//
// The first step of P0-B. It answers one question: are there really `TeeML` providers on the
// network, and which one do we pick?
//
// This distinction is not cosmetic. BUILD-PLAN P0-B/2:
//   TeeML  → the model runs INSIDE the enclave; the operator cannot see the data
//   TeeTLS → only the transport is encrypted; the model runs on an ordinary machine
// Our claim "the infrastructure cannot see the data" rests on TeeML. Picking TeeTLS would
// still produce a working demo and a false claim — so we filter here, not later.

import { createRequire } from 'node:module';
import { ethers } from 'ethers';
import { loadDotenv, requireEnv } from '../packages/shared/src/config.js';

// The SDK's ESM build is BROKEN in v0.9.0: lib.esm/index.mjs tries to pull named exports from
// a CJS chunk →
//   SyntaxError: The requested module './index-28fb2bc1.js' does not provide an export named 'C'
// The CJS build is sound, so we load it via createRequire. Once the package is patched this
// can go back to a plain import.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

loadDotenv();

const provider = new ethers.JsonRpcProvider(requireEnv('OG_RPC_URL'));
const wallet = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);

console.log(`wallet  : ${wallet.address}`);
console.log(`balance : ${ethers.formatEther(await provider.getBalance(wallet.address))} OG`);
console.log(`network : chainId ${(await provider.getNetwork()).chainId}\n`);

const broker = await createZGComputeNetworkBroker(wallet);

// Ledger status — we are NOT FUNDING yet, only looking.
try {
  const ledger = await broker.ledger.getLedger();
  console.log(`ledger  : ${ethers.formatEther(ledger.totalBalance)} OG (available: ${ethers.formatEther(ledger.availableBalance)})\n`);
} catch (err) {
  console.log(`ledger  : none yet (${(err as Error).message.slice(0, 60)})\n`);
}

// CAREFUL: the inference-side signature DIFFERS from the fine-tuning one.
//   inference   : listService(offset = 0, limit = 50, includeUnacknowledged = false)
//   fine-tuning : listService(includeUnacknowledged = false)
// The .d.ts shows both under the same name, so `listService(true)` means passing `true` as the
// offset → "invalid BigNumberish value". Confirmed from source:
// lib.commonjs/inference/broker/read-only-broker.js:36
const services = await broker.inference.listService(0, 50, true);
console.log(`${services.length} services found:\n`);

const byVerifiability = new Map<string, number>();
for (const s of services) {
  const v = s.verifiability || '(empty)';
  byVerifiability.set(v, (byVerifiability.get(v) ?? 0) + 1);
}
console.log('verifiability distribution:', Object.fromEntries(byVerifiability), '\n');

for (const s of services) {
  const teeml = s.verifiability === 'TeeML';
  console.log(`${teeml ? '✅ TeeML' : `   ${s.verifiability || '(empty)'}`}  ${s.provider}`);
  console.log(`     model     : ${s.model}`);
  console.log(`     url       : ${s.url}`);
  console.log(`     price     : input ${s.inputPrice} / output ${s.outputPrice} (neuron)`);
  if (teeml) {
    // We read DIRECTLY from the struct. We do NOT call checkProviderSignerStatus():
    // that function transfers MIN_TRANSFER_AMOUNT (1 OG!) when no sub-account exists with the
    // provider — we would burn 1 OG per provider just to list them.
    console.log(`     TEE signer: ${s.teeSignerAddress}`);
    console.log(`     acknowledged: ${s.teeSignerAcknowledged ? 'YES' : 'NO — processResponse returns false'}`);
    console.log(`     extra info  : ${s.additionalInfo || '(empty)'}`);
  }
  console.log();
}
