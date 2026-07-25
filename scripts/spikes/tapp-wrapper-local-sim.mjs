// P0(b) — Confirm the binding path (local simulation).
//
// WHY THIS EXISTS: github.com/0gfoundation/agent-wrapper's public repo does not contain a
// buildable entrypoint (no `cmd/wrapper/main.go` anywhere in the tree — confirmed by walking
// the full git tree, 93 files, zero `package main`). The README's `docker pull
// 0g-citizen-claw/agent-wrapper:latest` also does not resolve to any public registry we could
// find. So there is currently no way to boot the *real* wrapper binary, in DEMO_MODE or
// otherwise, from what 0G has published. See the P0(b) report for what remains blocked on
// 0G mentor / infra access.
//
// What we CAN do, and what this script does: reproduce the wrapper's confirmed signing
// contract exactly, verbatim from 0G's own source, and prove the preimage + brute-force-v
// recovery scheme actually works end-to-end against our tapp/chat.ts:
//
//   - internal/proxy/proxy.go `signResponse`:
//       content = fmt.Sprintf("%s|%s|%d|%s", agentId, sealId, timestamp, hex(sha256(body)))
//   - internal/sealed/state.go `SignWithAgentSealKey`:
//       hash := ethcrypto.Keccak256(data)          // NO EIP-191 prefix
//       signature := ethcrypto.Sign(hash, privKey) // 65 bytes, v normalized 27/28
//       return signature[:64]                       // R||S only, v discarded
//
// This is a SIMULATION of the wrapper's proxy/signing layer, not a real TEE/TDX-attested
// response. It is clearly labeled as such. It boots our real tapp/chat.ts as a child process
// and proxies/signs its real HTTP response bytes, so the preimage-reconstruction and
// ecrecover-with-brute-v mechanics are exercised for real, not mocked.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { recoverSealSigner } from '../recover.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const AGENT_PORT = 9000;
const AGENT_ID = 'bob-tapp-spike';
const SEAL_ID = '0x' + Buffer.from(crypto_randomHex(32), 'hex').toString('hex');

function crypto_randomHex(n) {
  return [...Array(n)].map(() => Math.floor(Math.random() * 256)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function waitFor(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await waitFor(200);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function main() {
  console.log('--- P0(b) local binding-path spike ---\n');

  // 1. Boot the real tapp/chat.ts as a child process (this IS our real agent code).
  console.log('[1/6] booting tapp/chat.ts on :%d ...', AGENT_PORT);
  const child = spawn('npx', ['tsx', 'tapp/chat.ts'], {
    cwd: repoRoot,
    env: { ...process.env, AGENT_PORT: String(AGENT_PORT), AGENT_ID },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`  [chat.ts] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`  [chat.ts:err] ${d}`));

  try {
    await waitForHealth(`http://localhost:${AGENT_PORT}/health`);
    console.log('      agent healthy.\n');

    // 2. Generate an ephemeral agentSealKey — exactly what the real Attestor would hand the
    //    wrapper via ECIES after remote attestation (internal/sealed/state.go SetAgentSealKey).
    //    "issued once per container run, NOT Bob's agentId" — CLAUDE.md §3.1(B).
    console.log('[2/6] generating ephemeral agentSealKey (simulating post-attestation issuance)...');
    const sealWallet = ethers.Wallet.createRandom();
    console.log('      agentSealKey address:', sealWallet.address, '\n');

    // 3. Hit the agent through a stand-in for the wrapper's proxy (:8080 -> :9000 in the real
    //    wrapper; here we just call it directly since we ARE the proxy for this step).
    console.log('[3/6] sending a job to /chat (this is what "the wrapper proxies" in prod)...');
    const requestBody = JSON.stringify({
      job: 'analyze-widget-report',
      intentHash: '0x' + crypto_randomHex(32),
      nonce: Date.now(),
    });
    const chatRes = await fetch(`http://localhost:${AGENT_PORT}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    const responseBodyBuf = Buffer.from(await chatRes.arrayBuffer());
    console.log('      agent responded:', responseBodyBuf.toString('utf8'), '\n');

    // 4. Sign the raw response bytes exactly as internal/proxy/proxy.go signResponse does.
    console.log('[4/6] signing the response body as the wrapper would (proxy.go signResponse)...');
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyHashHex = createHash('sha256').update(responseBodyBuf).digest('hex');
    const preimage = `${AGENT_ID}|${SEAL_ID}|${timestamp}|${bodyHashHex}`;
    const digest = ethers.keccak256(ethers.toUtf8Bytes(preimage)); // NO EIP-191 prefix
    const sig = sealWallet.signingKey.sign(digest); // raw secp256k1 sign over bare digest
    const signature64 = '0x' + sig.r.slice(2) + sig.s.slice(2); // R||S, v discarded (matches signature[:64])
    console.log('      preimage:', preimage);
    console.log('      signature (R||S, v discarded):', signature64, '\n');

    // 5. Write the capture file — same shape scripts/recover.js expects.
    const capture = {
      agentId: AGENT_ID,
      sealId: SEAL_ID,
      timestamp,
      bodyBase64: responseBodyBuf.toString('base64'),
      signature: signature64,
      // NOT part of the real capture contract — only here so this script can self-check.
      _groundTruthSealAddress: sealWallet.address,
    };
    const capturePath = path.join(__dirname, '.capture-p0b.json');
    writeFileSync(capturePath, JSON.stringify(capture, null, 2));
    console.log('[5/6] wrote capture to', capturePath, '\n');

    // 6. Recover — exercise the SAME code path scripts/recover.js's CLI uses.
    console.log('[6/6] running recover.js logic against the capture...');
    const result = recoverSealSigner(AGENT_ID, SEAL_ID, timestamp, responseBodyBuf, signature64);
    console.log('      preimage reconstructed:', result.preimage);
    console.log('      matches original preimage:', result.preimage === preimage);
    for (const c of result.candidates) {
      const isGroundTruth = c.address && c.address.toLowerCase() === sealWallet.address.toLowerCase();
      console.log(`      v=${c.v}: ${c.address ?? c.error}${isGroundTruth ? '  <-- MATCHES ground-truth agentSealKey address' : ''}`);
    }

    const matched = result.candidates.some(
      (c) => c.address && c.address.toLowerCase() === sealWallet.address.toLowerCase()
    );

    console.log('\n--- RESULT ---');
    if (matched) {
      console.log('PASS: recover.js recovered the correct seal-key signer address via brute-force v.');
    } else {
      console.log('FAIL: no v in {27,28} recovered the ground-truth address.');
      process.exitCode = 1;
    }
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error('spike failed:', err);
  process.exitCode = 1;
});
