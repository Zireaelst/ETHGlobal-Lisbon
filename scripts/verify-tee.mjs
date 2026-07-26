// scripts/verify-tee.mjs — recover the 0G TEE signature from a recorded response, independently.
//
//   node scripts/verify-tee.mjs fixtures/og/run-1f7aba48d8b90240.json
//
// Nothing here trusts our code. It takes a recorded 0G response and answers two questions with
// plain ethers and node's own crypto:
//
//   1. WHO SIGNED IT — recover the signer of the tuple 0G returned, and compare against the TEE
//      signer address registered for that provider on 0G Chain (`pnpm tsx scripts/og-list.ts`
//      reads it from the contract, and only an ACKNOWLEDGED signer is the contract owner's word
//      rather than the provider's own claim).
//
//   2. IS IT OUR RESPONSE — the signature does not cover the answer text. It covers a colon-joined
//      tuple that contains the sha256 of the RAW response body, so the check is whether the digest
//      of the bytes we hold appears in the tuple that was signed. Hash the raw bytes: a
//      JSON.parse → JSON.stringify round trip changes them and the digest stops matching.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/verify-tee.mjs <fixtures/og/run-*.json>');
  process.exit(1);
}

const run = JSON.parse(readFileSync(path, 'utf8'));

// EIP-191 personal_sign, so it is forwardable and verifiable by anyone holding the response.
const recovered = ethers.verifyMessage(run.signature.text, run.signature.signature);
const expected = run.verification.expectedSigner;
const signerOk = recovered.toLowerCase() === expected.toLowerCase();

const digest = createHash('sha256').update(run.rawResponseText).digest('hex');
const covered = run.signature.text.split(':').includes(digest);

console.log(`signed tuple      : ${run.signature.text}`);
console.log(`recovered signer  : ${recovered}`);
console.log(`0G TEE signer     : ${expected}`);
console.log(`  same address    : ${signerOk ? 'YES' : 'NO'}`);
console.log(`sha256(raw body)  : ${digest}`);
console.log(`  inside the tuple: ${covered ? 'YES' : 'NO'}`);
console.log('');
console.log(
  signerOk && covered
    ? 'A genuine 0G TEE signed a tuple carrying the fingerprint of this exact response.'
    : 'VERIFICATION FAILED — do not claim this response came from a 0G enclave.',
);

process.exit(signerOk && covered ? 0 : 1);
