// Recover the live enclave seal-key signer (see CLAUDE.md §3.2, §3.1(B)).
//
// Preimage: keccak256("agentId|sealId|timestamp|hex(sha256(body))") — a pipe-joined ASCII
// string; the body is sha256'd first, hex-encoded, then folded into the string, then
// keccak256 is signed. NO EIP-191 prefix — this is NOT ethers.recoverAddress(hashMessage(...)),
// it is raw secp256k1 recovery over the bare keccak256 digest (ethers.SigningKey.recoverPublicKey).
//
// Signature is 64-byte R||S — the wrapper discards v (see agent-wrapper/internal/proxy/proxy.go
// signResponse + internal/sealed/state.go SignWithAgentSealKey, which literally does
// `signature[:64]` after ethcrypto.Sign). So v must be brute-forced from {27, 28}.
//
// Usage:
//   node scripts/recover.js <capture.json> [expectedAddress]
//
// capture.json shape (see scripts/spikes/tapp-wrapper-local-sim.mjs for a producer):
//   {
//     "agentId": "bob-tapp-spike",
//     "sealId": "0x...",
//     "timestamp": 1732472000,
//     "bodyBase64": "<base64 of the EXACT raw response bytes the wrapper signed>",
//     "signature": "0x<128 hex chars, R||S, no v>"
//   }

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const crypto = require('crypto');

/**
 * Reconstruct the wrapper's preimage string.
 * @param {string} agentId
 * @param {string} sealId
 * @param {number|string} timestamp
 * @param {Buffer} bodyBuf - the exact raw bytes the wrapper read back from the agent response.
 */
function buildPreimage(agentId, sealId, timestamp, bodyBuf) {
  const bodyHashHex = crypto.createHash('sha256').update(bodyBuf).digest('hex');
  return `${agentId}|${sealId}|${timestamp}|${bodyHashHex}`;
}

/**
 * Recover candidate signer addresses for both possible v values.
 * @returns {{ preimage: string, digest: string, candidates: Array<{v:number, address?:string, error?:string}> }}
 */
function recoverSealSigner(agentId, sealId, timestamp, bodyBuf, signatureHex) {
  const preimage = buildPreimage(agentId, sealId, timestamp, bodyBuf);

  // No EIP-191 prefix: sign/recover over the bare keccak256(preimage) digest.
  const digest = ethers.keccak256(ethers.toUtf8Bytes(preimage));

  const sig = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
  if (sig.length !== 128) {
    throw new Error(`expected 64-byte (128 hex char) R||S signature, got ${sig.length / 2} bytes`);
  }
  const r = '0x' + sig.slice(0, 64);
  const s = '0x' + sig.slice(64, 128);

  const candidates = [];
  for (const v of [27, 28]) {
    try {
      const pubKey = ethers.SigningKey.recoverPublicKey(digest, { r, s, v });
      const address = ethers.computeAddress(pubKey);
      candidates.push({ v, address });
    } catch (err) {
      candidates.push({ v, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { preimage, digest, candidates };
}

module.exports = { buildPreimage, recoverSealSigner };

// --- CLI entrypoint ---
if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/recover.js <capture.json> [expectedAddress]');
    process.exit(1);
  }

  const capturePath = path.resolve(file);
  const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  const { agentId, sealId, timestamp, bodyBase64, signature } = capture;

  if (!agentId || !sealId || timestamp === undefined || !bodyBase64 || !signature) {
    console.error('capture.json must have: agentId, sealId, timestamp, bodyBase64, signature');
    process.exit(1);
  }

  const bodyBuf = Buffer.from(bodyBase64, 'base64');
  const { preimage, digest, candidates } = recoverSealSigner(agentId, sealId, timestamp, bodyBuf, signature);

  console.log('preimage:', preimage);
  console.log('digest (keccak256, no EIP-191 prefix):', digest);
  console.log('recovery candidates:');
  for (const c of candidates) {
    console.log(`  v=${c.v}:`, c.address ?? `ERROR (${c.error})`);
  }

  const expected = process.argv[3] || process.env.EXPECTED_SEAL_ADDRESS;
  if (expected) {
    const match = candidates.find((c) => c.address && c.address.toLowerCase() === expected.toLowerCase());
    if (match) {
      console.log(`\nMATCH: v=${match.v} recovers the expected seal-key signer ${expected}`);
    } else {
      console.log(`\nNO MATCH: neither v=27 nor v=28 recovers expected ${expected}`);
      process.exitCode = 1;
    }
  } else {
    console.log(
      '\nNo expectedAddress given — both candidates are "plausible" secp256k1 addresses.' +
        ' In production, cross-check against GetAgentMetadata(agentId).agentSeal or the address' +
        " you're about to register via setEnclaveSigner (CLAUDE.md §3.2)."
    );
  }
}
