// tests/gates/P4-E.ts — the THIRD rail: x402 `exact` on X Layer testnet, settled by OKX.
//
// Exit criteria:
//   [ ] okx-x402 satisfies PaymentBackend, and three rails now name three DIFFERENT rails
//   [ ] settle() is gated on JobVerified — STRUCTURALLY, like the other two
//   [ ] a REAL JobVerified tx passes the gate; a REAL fraud tx does NOT
//   [ ] the EIP-712 domain we publish is the one THE CHAIN agrees with, not the one OKX's
//       mock merchant advertises (they differ, and the contract is what verifies)
//   [ ] X Layer testnet is chainId 1952 and answers
//   [ ] the honesty rule holds: nothing in the repo claims the payment signature covers
//       `intentHash` on this rail
//
// The last criterion is a GREP, deliberately. `extra.intentHash` is carried but NOT signed
// (the `exact` scheme signs `(from,to,value,validAfter,validBefore,nonce)` only), and the
// easiest way for this project to become dishonest is for someone to describe that field as a
// cryptographic binding in a README six weeks from now. The gate is cheaper than the vigilance.
//
// NOTE ON CREDENTIALS: this gate runs WITHOUT OKX credentials. Everything above is provable
// offline or against public endpoints. Only a live settlement needs a key, and a gate whose
// outcome depends on a third party's API key is not a gate.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ethers, keccak256, AbiCoder, toUtf8Bytes } from 'ethers';

import {
  SettlementNotAuthorizedError,
  assertJobVerified,
  type PaymentBackend,
} from '../../packages/payment/src/index.js';
import { createOkxX402Backend, XLAYER_CHAIN_ID, XLAYER_TESTNET, xlayerAsset } from '../../packages/payment/src/okx-x402.js';
import { OkxFacilitatorClient, createOkxFacilitatorFromEnv } from '../../packages/payment/src/okx-facilitator.js';
import { createHederaX402Backend } from '../../packages/payment/src/hedera-x402.js';
import { createHederaSigner } from '../../packages/payment/src/signer/hedera-signer.js';
import { createBaseStealthBackend } from '../../packages/payment/src/base-stealth.js';
import { loadConfig, loadDotenv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const gate = new Gate('P4-E', 'Third rail — x402 exact on X Layer testnet, settled by OKX');
const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
const verifierAddress = requireEnv('VERIFIER_ADDRESS');
const XLAYER_RPC = process.env.XLAYER_RPC_URL?.trim() || 'https://testrpc.xlayer.tech/terigon';

type P3DEvidence = {
  honestRuns?: Array<{ txHash?: string; signedIntentHash: string; bodyIntentHash: string }>;
  fraudRuns?: Record<string, { tx?: string; name: string }>;
};
let p3d: P3DEvidence = {};
try {
  p3d = JSON.parse(readFileSync(resolve(root, 'fixtures/p3d/P3-D.json'), 'utf8')) as P3DEvidence;
} catch {
  /* the checks below report this meaningfully */
}

/** A facilitator instance is needed to construct the backend; credentials are not. */
const facilitator =
  createOkxFacilitatorFromEnv() ??
  new OkxFacilitatorClient({ apiKey: 'gate-offline', secretKey: 'gate-offline', passphrase: 'gate-offline' });

let okx: PaymentBackend | undefined;

async function xlayerRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(XLAYER_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`X Layer RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

// ---------------------------------------------------------------------------
// 1. Interface
// ---------------------------------------------------------------------------
gate.check('okx-x402 satisfies PaymentBackend and is a THIRD distinct rail', () => {
  okx = createOkxX402Backend({
    payerPrivateKey: cfg.PRIVATE_KEY_ALICE,
    facilitator,
    verifierProvider: provider,
    verifierAddress,
  });
  const hedera = createHederaX402Backend({
    signer: createHederaSigner({ accountId: cfg.HEDERA_OPERATOR_ID }),
    facilitatorUrl: cfg.BLOCKY402_URL,
    verifierProvider: provider,
    verifierAddress,
  });
  const base = createBaseStealthBackend({
    provider,
    payerPrivateKey: cfg.PRIVATE_KEY_ALICE,
    usdcAddress: cfg.USDC_BASE_SEPOLIA,
    verifierAddress,
  });

  const required = ['quote', 'authorize', 'verifyAuthorization', 'settle', 'verify'] as const;
  const problems: string[] = [];
  for (const b of [hedera, base, okx]) {
    if (!b.rail) problems.push('rail field missing');
    for (const m of required) {
      if (typeof (b as unknown as Record<string, unknown>)[m] !== 'function') {
        problems.push(`${b.rail}: ${m}() missing`);
      }
    }
  }
  const rails = [hedera, base, okx].map((b) => b.rail);
  if (new Set(rails).size !== 3) problems.push(`expected three distinct rails, got: ${rails.join(', ')}`);

  return problems.length === 0
    ? pass(`${rails.join(' · ')} — all five interface methods present on each`)
    : fail(problems.join('\n'));
});

// ---------------------------------------------------------------------------
// 2. The settlement gate
// ---------------------------------------------------------------------------
gate.check('settle() without a jobVerifiedTx is REFUSED', async () => {
  if (!okx) return fail('backend was not constructed');
  try {
    await okx.settle(
      { rail: 'okx-x402', intentHash: `0x${'11'.repeat(32)}`, payTo: 'x', amount: '1', payload: {} },
      '',
    );
    return fail('settle() did not throw on an empty jobVerifiedTx');
  } catch (err) {
    return err instanceof SettlementNotAuthorizedError
      ? pass('the third rail releases no money for an unverified job')
      : fail(`expected SettlementNotAuthorizedError, got: ${String(err).slice(0, 120)}`);
  }
});

gate.check('a REAL JobVerified tx passes the gate', async () => {
  const run = p3d.honestRuns?.find((r) => r.txHash);
  if (!run?.txHash) return fail('no JobVerified tx in fixtures/p3d/P3-D.json — run pnpm gate:P3-D first');

  const proof = await assertJobVerified(provider, verifierAddress, run.txHash, run.signedIntentHash);
  return proof.intentHash.toLowerCase() === run.signedIntentHash.toLowerCase()
    ? pass(`tx ${run.txHash.slice(0, 20)}… block ${proof.blockNumber} · agentId ${proof.agentId}`)
    : fail('the gate returned the wrong intentHash');
});

gate.check('a REAL fraud tx does NOT pass (the fraud run cannot settle on this rail either)', async () => {
  const fraud = Object.entries(p3d.fraudRuns ?? {}).find(([, v]) => v.tx);
  if (!fraud) return fail('no fraud tx in fixtures/p3d/P3-D.json — run pnpm gate:P3-D first');
  const [mode, info] = fraud;
  try {
    await assertJobVerified(provider, verifierAddress, info.tx!, `0x${'22'.repeat(32)}`);
    return fail(`${mode} tx passed the JobVerified gate — the payment could have settled`);
  } catch (err) {
    return err instanceof SettlementNotAuthorizedError
      ? pass(`${mode} (${info.name}) refused:\n${(err as Error).message.slice(0, 140)}`)
      : fail(`expected SettlementNotAuthorizedError: ${String(err).slice(0, 100)}`);
  }
});

// ---------------------------------------------------------------------------
// 3. X Layer testnet is real and is 1952
// ---------------------------------------------------------------------------
gate.check(`X Layer testnet answers and is chainId ${XLAYER_CHAIN_ID}`, async () => {
  const [idHex, blockHex] = await Promise.all([
    xlayerRpc<string>('eth_chainId', []),
    xlayerRpc<string>('eth_blockNumber', []),
  ]);
  const id = Number.parseInt(idHex, 16);
  if (id !== XLAYER_CHAIN_ID) {
    return fail(`chainId is ${id}, expected ${XLAYER_CHAIN_ID} — XLAYER_RPC_URL points at the wrong network (195 is the RETIRED testnet)`);
  }
  return pass(`${XLAYER_TESTNET} · block ${Number.parseInt(blockHex, 16)} · ${XLAYER_RPC}`);
});

// ---------------------------------------------------------------------------
// 4. The domain we publish is the one the CHAIN agrees with
// ---------------------------------------------------------------------------
gate.check('the asset EIP-712 domain is reproduced from the contract, not from a document', async () => {
  const asset = xlayerAsset();

  const call = (data: string) => xlayerRpc<string>('eth_call', [{ to: asset.address, data }, 'latest']);
  const decodeString = (hex: string): string | null => {
    if (!hex || hex === '0x') return null;
    const b = Buffer.from(hex.slice(2), 'hex');
    if (b.length < 64) return null;
    const len = Number(BigInt(`0x${b.subarray(32, 64).toString('hex') || '0'}`));
    return len ? b.subarray(64, 64 + len).toString('utf8') : null;
  };

  const [nameHex, sepHex, decHex] = await Promise.all([
    call('0x06fdde03'), // name()
    call('0x3644e515'), // DOMAIN_SEPARATOR()
    call('0x313ce567'), // decimals()
  ]);

  const onchainName = decodeString(nameHex);
  const decimals = Number.parseInt(decHex, 16);
  const problems: string[] = [];
  if (onchainName !== asset.eip712Name) problems.push(`name(): chain says "${onchainName}", we publish "${asset.eip712Name}"`);
  if (decimals !== asset.decimals) problems.push(`decimals(): chain says ${decimals}, we publish ${asset.decimals}`);

  // Rebuild DOMAIN_SEPARATOR locally and confirm OUR version is the one that reproduces it.
  const TYPEHASH = keccak256(
    toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
  );
  const rebuild = (version: string) =>
    keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [TYPEHASH, keccak256(toUtf8Bytes(asset.eip712Name)), keccak256(toUtf8Bytes(version)), XLAYER_CHAIN_ID, asset.address],
      ),
    );

  if (rebuild(asset.eip712Version).toLowerCase() !== sepHex.toLowerCase()) {
    const alt = ['1', '2', '3'].find((v) => rebuild(v).toLowerCase() === sepHex.toLowerCase());
    problems.push(
      `DOMAIN_SEPARATOR does not reproduce under version "${asset.eip712Version}"` +
        (alt ? ` — it reproduces under "${alt}". A signature under the wrong version is REJECTED on chain.` : ''),
    );
  }

  return problems.length === 0
    ? pass(
        [
          `${asset.symbol} ${asset.address}`,
          `name="${asset.eip712Name}" version="${asset.eip712Version}" decimals=${asset.decimals}`,
          `DOMAIN_SEPARATOR ${sepHex.slice(0, 22)}… reproduced locally ✓`,
        ].join('\n'),
      )
    : fail(problems.join('\n'));
});

gate.check("OKX's own mock merchant still disagrees — and we still believe the chain", async () => {
  // Not a failure of ours: it documents a live third-party bug that would silently break
  // signing if someone "fixed" our constant to match the merchant.
  try {
    const res = await fetch('https://www.okx.com/api/v1/pay/mock-merchant/resource', {
      signal: AbortSignal.timeout(25_000),
    });
    // 402 is the CORRECT answer from a paywalled resource and carries the accepts[] body —
    // treating it as a failure would let this check pass without ever comparing anything.
    if (!res.ok && res.status !== 402) {
      return pass(`mock merchant unreachable (HTTP ${res.status}) — nothing to compare, our value stays chain-derived`);
    }
    const body = (await res.json()) as {
      accepts?: Array<{ network?: string; asset?: string; extra?: { name?: string; version?: string } }>;
    };
    const entry = body.accepts?.find((a) => a.network === XLAYER_TESTNET);
    if (!entry) return fail(`OKX mock merchant no longer advertises ${XLAYER_TESTNET} — testnet support may have changed`);

    const asset = xlayerAsset();
    const note =
      entry.extra?.version && entry.extra.version !== asset.eip712Version
        ? `merchant says version="${entry.extra.version}", chain says "${asset.eip712Version}" — we sign under the chain's`
        : `merchant and chain agree on version="${asset.eip712Version}"`;
    return pass(`OKX serves ${XLAYER_TESTNET} live (testnet IS supported) · ${note}`);
  } catch (err) {
    return pass(`mock merchant not reachable (${String(err).slice(0, 60)}) — our domain stays chain-derived`);
  }
});

// ---------------------------------------------------------------------------
// 5. The honesty rule
// ---------------------------------------------------------------------------
gate.check('nothing claims the payment signature covers intentHash on this rail', () => {
  // The `exact` scheme signs (from,to,value,validAfter,validBefore,nonce). `extra` is NOT in
  // the digest. Any sentence pairing the payload with a cryptographic binding is false here.
  const forbidden = [
    'intentHash is embedded in the payload and protected',
    'cryptographically bound to the job',
    'payment signature covers the intentHash',
    'signed into the payment payload',
  ];
  let hits: string[] = [];
  try {
    const out = execFileSync(
      'git',
      [
        'grep', '-rniI', '-e', forbidden.join('\\|'),
        '--',
        '*.ts', '*.tsx', '*.md',
        // Exclude THIS FILE. It necessarily contains every forbidden phrase — they are the
        // needle it searches for. Found the moment the gate was first committed: while the
        // file was untracked `git grep` could not see it, so the check passed for a reason
        // that stopped being true the instant it mattered.
        `:!${'tests/gates/P4-E.ts'}`,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    hits = out.split('\n').filter(Boolean);
  } catch {
    // git grep exits 1 when there are no matches — that is the passing case.
  }
  // Lines that STATE THE NEGATIVE are the correct way to talk about this and must not trip it.
  const real = hits.filter((l) => !/NOT|not |never|DO NOT|false on this rail/i.test(l));
  return real.length === 0
    ? pass(`no overclaim found (${hits.length} line(s) mention it, all in the negative)`)
    : fail(`these lines claim the payment signature binds the intent — it does not:\n${real.slice(0, 5).join('\n')}`);
});

// ---------------------------------------------------------------------------
// 6. Credentials, reported honestly
// ---------------------------------------------------------------------------
gate.check('a live settlement is possible when credentials are present (reported, not required)', async () => {
  const live = createOkxFacilitatorFromEnv();
  if (!live) {
    return pass(
      [
        'OKX credentials absent — the offline criteria above are what this gate proves.',
        'To settle for real: OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE',
        '  (https://web3.okx.com/onchainos/dev-portal), then PAYMENT_BACKEND=okx pnpm demo:base',
      ].join('\n'),
    );
  }
  try {
    const supported = await live.getSupported();
    const covered = (supported?.kinds ?? []).some(
      (k: { scheme?: string; network?: string }) => k.scheme === 'exact' && k.network === XLAYER_TESTNET,
    );
    return covered
      ? pass(`OKX facilitator lists exact/${XLAYER_TESTNET} — live settlement available`)
      : fail(`OKX facilitator does NOT list exact/${XLAYER_TESTNET}; the rail must not be offered`);
  } catch (err) {
    return fail(`OKX credentials present but /supported failed: ${String(err).slice(0, 160)}`);
  }
});

await gate.run();
