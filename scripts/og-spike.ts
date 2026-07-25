// scripts/og-spike.ts — P0-B: one 0G Sealed Inference call + capturing the signature.
//
// This script SPENDS MONEY (ledger funding + the call fee). It is run once to produce the
// fixture; the gate (tests/gates/P0-B.ts) then verifies that fixture.
//
// HONESTY RULE: even when the SDK's `processResponse()` says "valid", we do not rely on that
// alone. We download the signature ourselves and recover it with our own code.
// If the two disagree, no fixture is written.
//
// The flow, confirmed from source (lib.commonjs/inference/broker/{response,verifier}.js):
//   signature: GET {svc.url}/v1/proxy/signature/{chatID}?model={model} → {text, signature}
//   verify   : ethers.hashMessage(text) + recoverAddress  → EIP-191 (confirms CLAUDE.md §3.1)
//   signer   : svc.teeSignerAddress, AMA additionalInfo.TargetSeparated===true ve
//              ProviderType!=='centralized' ise additionalInfo.TargetTeeAddress
//              (meaning the model runs in its own separate TEE)

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';
import { loadDotenv, optionalEnv, repoRoot, requireEnv } from '../packages/shared/src/config.js';

// The SDK v0.9.0 ESM build is broken (see scripts/og-list.ts) → CJS.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

loadDotenv();
const root = repoRoot();

/** The SDK's client-side floor: lib.commonjs/ledger/ledger.js MIN_LEDGER_BALANCE_OG = 3. */
const SDK_MIN_LEDGER_OG = 3;

/** Image models do no text analysis — they are filtered out of provider selection. */
const IMAGE_MODEL_HINT = /image|vision|diffusion/i;

const PROMPT =
  'You are a security analyst. In exactly three sentences, explain why binding a ' +
  'payment intent hash to a model output matters for autonomous agent marketplaces.';

const provider = new ethers.JsonRpcProvider(requireEnv('OG_RPC_URL'));
const wallet = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);
const log = (l: string) => console.log(l);

log(`wallet : ${wallet.address}`);
log(`balance: ${ethers.formatEther(await provider.getBalance(wallet.address))} OG\n`);

const broker = await createZGComputeNetworkBroker(wallet);

// ---------------------------------------------------------------------------
// 1. The ledger — open one if absent
// ---------------------------------------------------------------------------
let ledger: { totalBalance: bigint; availableBalance: bigint } | undefined;
try {
  ledger = await broker.ledger.getLedger();
} catch {
  ledger = undefined;
}

if (!ledger) {
  log(`no ledger → addLedger(${SDK_MIN_LEDGER_OG}) …`);
  await broker.ledger.addLedger(SDK_MIN_LEDGER_OG);
  ledger = await broker.ledger.getLedger();
}
// Opening a provider sub-account locks 1 OG (MIN_TRANSFER_AMOUNT) from the ledger.
// If the available balance drops below that, the SDK cannot auto-fund and just prints a
// warning. We top up in advance.
const MIN_AVAILABLE_OG = 10n ** 18n;
if (ledger!.availableBalance < MIN_AVAILABLE_OG) {
  log(`available balance is low (${ethers.formatEther(ledger!.availableBalance)} OG) → depositFund(2) …`);
  await broker.ledger.depositFund(2);
  ledger = await broker.ledger.getLedger();
}
log(`ledger : ${ethers.formatEther(ledger!.totalBalance)} OG total / ${ethers.formatEther(ledger!.availableBalance)} OG available\n`);

// ---------------------------------------------------------------------------
// 2. Provider selection — TeeML ONLY
// ---------------------------------------------------------------------------
type Service = {
  provider: string;
  model: string;
  url: string;
  verifiability: string;
  inputPrice: bigint;
  outputPrice: bigint;
  additionalInfo: string;
  teeSignerAddress: string;
  teeSignerAcknowledged: boolean;
};

// listService returns an ethers `Result`: a FROZEN array. filter() produces a Result too, so
// sort() throws "Cannot assign to read only property".
// We copy it into a plain array with Array.from.
const services: Service[] = Array.from(await broker.inference.listService(0, 50, true));
const teeml = Array.from(services.filter((s) => s.verifiability === 'TeeML'));
if (teeml.length === 0) throw new Error('no TeeML provider on the network — P0-B cannot proceed');

const pinned = optionalEnv('OG_PROVIDER_ADDRESS');
let chosen: Service | undefined;
if (pinned) {
  chosen = teeml.find((s) => s.provider.toLowerCase() === pinned.toLowerCase());
  if (!chosen) throw new Error(`OG_PROVIDER_ADDRESS=${pinned} TeeML listesinde yok`);
} else {
  // THE ACKNOWLEDGEMENT REQUIREMENT: when `teeSignerAcknowledged` is false, that provider's
  // TEE signer address sits in the contract as the PROVIDER'S OWN CLAIM — the contract owner
  // has not vouched for it. processResponse returns false in that case (source:
  // lib.commonjs/inference/broker/response.js:36). Even if the signature verified against an
  // unacknowledged provider, we could not say "a 0G TEE produced this", so we filter here.
  const eligible = Array.from(
    teeml.filter((s) => s.teeSignerAcknowledged && !IMAGE_MODEL_HINT.test(s.model)),
  );
  if (eligible.length === 0) {
    const why = teeml
      .map((s) => `  ${s.provider} ${s.model} — acknowledged:${s.teeSignerAcknowledged}`)
      .join('\n');
    throw new Error(`no acknowledged TeeML text provider:\n${why}`);
  }
  chosen = eligible.sort((a, b) => (a.outputPrice === b.outputPrice
    ? Number(a.inputPrice - b.inputPrice)
    : Number(a.outputPrice - b.outputPrice)))[0];
}
if (!chosen) throw new Error('no suitable TeeML text provider found');
if (!chosen.teeSignerAcknowledged) {
  throw new Error(`the pinned provider ${chosen.provider} is unacknowledged — the signature cannot be verified`);
}

log(`provider  : ${chosen.provider}`);
log(`model     : ${chosen.model}`);
log(`url       : ${chosen.url}`);
log(`price     : input ${chosen.inputPrice} / output ${chosen.outputPrice} neuron\n`);

// ---------------------------------------------------------------------------
// 3. TEE signer + onay
// ---------------------------------------------------------------------------
let status = await broker.inference.checkProviderSignerStatus(chosen.provider);
if (!status.isAcknowledged) {
  log('provider not acknowledged → acknowledgeProviderSigner() …');
  await broker.inference.acknowledgeProviderSigner(chosen.provider);
  status = await broker.inference.checkProviderSignerStatus(chosen.provider);
}
if (!status.isAcknowledged) throw new Error('still unacknowledged after acknowledgeProviderSigner');
log(`TEE signer (kontrat): ${status.teeSignerAddress}`);

// Which address the signature must verify against can depend on additionalInfo.
let expectedSigner: string = status.teeSignerAddress;
let targetSeparated = false;
let providerType = 'decentralized';
if (chosen.additionalInfo) {
  try {
    const info = JSON.parse(chosen.additionalInfo) as {
      ProviderType?: string;
      TargetSeparated?: boolean;
      TargetTeeAddress?: string;
    };
    providerType = info.ProviderType ?? 'decentralized';
    targetSeparated = info.TargetSeparated === true;
    if (targetSeparated && providerType !== 'centralized' && info.TargetTeeAddress) {
      expectedSigner = info.TargetTeeAddress;
      log(`separated TEE: the model runs in its own enclave → expected signer ${expectedSigner}`);
    }
  } catch {
    log('WARNING: additionalInfo could not be parsed as JSON');
  }
}
log('');

// ---------------------------------------------------------------------------
// 4. The call
// ---------------------------------------------------------------------------
const { endpoint, model } = await broker.inference.getServiceMetadata(chosen.provider);
log(`endpoint : ${endpoint}`);
log(`model    : ${model}\n`);

// Headers are SINGLE-USE — fetched again for every request.
const headers = await broker.inference.getRequestHeaders(chosen.provider);

const body = {
  model,
  messages: [{ role: 'user', content: PROMPT }],
};

log('calling …');
const startedAt = Date.now();
const res = await fetch(`${endpoint}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
  body: JSON.stringify(body),
});
const latencyMs = Date.now() - startedAt;

if (!res.ok) {
  throw new Error(`call failed: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
}

// We keep the RAW body. The signature is over sha256(raw body); parsing the JSON and
// stringifying it again depends on key order and would break silently the day the provider
// reorders its fields.
const rawResponseText = await res.text();
const completion = JSON.parse(rawResponseText) as {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: Record<string, number>;
};
// chatID is read from the `ZG-Res-Key` header FIRST; `completion.id` is only a fallback.
// Kaynak: cli.commonjs/sdk/inference/broker/broker.js:342 —
//   const chatID = response.headers.get('ZG-Res-Key') || completion.id
// With completion.id the signature server answers "chat_id_not_found".
const resKey = res.headers.get('ZG-Res-Key');
const chatID = resKey ?? completion.id;
const output = completion.choices?.[0]?.message?.content ?? '';
log(`ZG-Res-Key: ${resKey ?? '(header absent — falling back to completion.id)'}`);

log(`response : ${latencyMs} ms, chatID=${chatID}`);
log(`output   : ${output.slice(0, 160)}${output.length > 160 ? '…' : ''}\n`);
if (!chatID) throw new Error('the response carries no chatID (id) — the signature cannot be downloaded');

// ---------------------------------------------------------------------------
// 5. The signature — via the SDK AND via our own code
// ---------------------------------------------------------------------------
// The independent path FIRST: we download the signature ourselves so that on failure we see
// the real HTTP status instead of the "getting signature error" the SDK swallows.
//
// The signature may not be ready server-side immediately after the call → a short backoff.
// URL variants: the SDK does NOT encode the model, but the model name contains a `/`
// (qwen/qwen2.5-omni-7b), so we try both forms.
type SigResponse = { text: string; signature: string };

const sigVariants = [
  `${chosen.url}/v1/proxy/signature/${chatID}?model=${chosen.model}`,
  `${chosen.url}/v1/proxy/signature/${chatID}?model=${encodeURIComponent(chosen.model)}`,
  `${chosen.url}/v1/proxy/signature/${chatID}`,
];

let sig: SigResponse | undefined;
let sigUrlUsed = '';
const attempts: string[] = [];

for (let round = 0; round < 6 && !sig; round += 1) {
  for (const url of sigVariants) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (r.ok) {
      sig = (await r.json()) as SigResponse;
      sigUrlUsed = url;
      break;
    }
    attempts.push(`HTTP ${r.status} ${url.replace(chosen.url, '')} → ${(await r.text()).slice(0, 120)}`);
  }
  if (!sig) await new Promise((r) => setTimeout(r, 1500));
}

if (!sig) {
  throw new Error(`could not download the signature. Attempts:\n${attempts.slice(-6).join('\n')}`);
}
log(`sig URL  : ${sigUrlUsed.replace(chosen.url, '')}`);

let sdkValid: boolean | null = null;
try {
  sdkValid = await broker.inference.processResponse(
    chosen.provider,
    chatID,
    JSON.stringify(completion.usage ?? {}),
  );
} catch (err) {
  log(`SDK processResponse ERROR: ${(err as Error).message}`);
}
log(`SDK processResponse : ${sdkValid}`);

const recovered = ethers.verifyMessage(sig.text, sig.signature);
const ourValid = recovered.toLowerCase() === expectedSigner.toLowerCase();

log(`signed text         : ${sig.text.length} characters`);
log(`recovered address   : ${recovered}`);
log(`expected signer     : ${expectedSigner}`);
log(`OUR verification    : ${ourValid}\n`);

if (!ourValid) {
  throw new Error(
    `SIGNATURE NOT VERIFIED — recovered ${recovered}, expected ${expectedSigner}. No fixture written.`,
  );
}
if (sdkValid !== true) {
  throw new Error(`SDK processResponse returned ${sdkValid} while we found true — a contradiction. No fixture written.`);
}

// ---------------------------------------------------------------------------
// 5b. WHAT does the signature cover? — the CLAUDE.md §3.1 correction
//
// §3.1 says "the signature covers the OUTPUT text". With this provider it does NOT. What is
// signed is a tuple:
//     "<h1>:<h2>:<ProviderType>:<ProviderIdentity>:<h3>"
// Found experimentally: h2 === sha256(raw response body). So the output IS within the
// signature's scope — not as plain text, but as the digest of the body.
//
// We recompute and verify this ourselves; that equality is the only basis on which we may say
// "the signature is bound to the output".
// ---------------------------------------------------------------------------
const sigParts = sig.text.split(':');
const responseDigest = createHash('sha256').update(rawResponseText).digest('hex');
const digestIndex = sigParts.indexOf(responseDigest);
const signedCoversOutput = digestIndex !== -1;

log(`signed tuple part count   : ${sigParts.length}`);
log(`sha256(raw response)      : ${responseDigest}`);
log(`demetteki konumu          : ${digestIndex === -1 ? 'YOK' : `#${digestIndex}`}`);

if (!signedCoversOutput) {
  throw new Error(
    'The signed tuple DOES NOT CONTAIN the sha256 of the response body — which means the ' +
      `signature is not bound to the output, and the thesis cannot be built this way.\ntuple: ${sig.text}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Fixture
// ---------------------------------------------------------------------------
const dir = resolve(root, 'fixtures/og');
mkdirSync(dir, { recursive: true });

writeFileSync(
  resolve(dir, 'signer.json'),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      chainId: 16602,
      provider: chosen.provider,
      model: chosen.model,
      url: chosen.url,
      verifiability: chosen.verifiability,
      teeSignerAddress: status.teeSignerAddress,
      expectedSigner,
      targetSeparated,
      providerType,
      isAcknowledged: status.isAcknowledged,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

writeFileSync(
  resolve(dir, 'run-1.json'),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      request: { endpoint, model, prompt: PROMPT },
      response: completion,
      rawResponseText,
      output,
      latencyMs,
      chatID,
      signature: sig,
      verification: {
        sdkProcessResponse: sdkValid,
        independentRecovered: recovered,
        expectedSigner,
        independentValid: ourValid,
        signedTextCoversOutput: signedCoversOutput,
        scheme: 'EIP-191 (ethers.verifyMessage)',
        signedTuple: sig.text,
        signedTupleParts: sigParts,
        responseSha256: responseDigest,
        responseDigestIndexInTuple: digestIndex,
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const after = await broker.ledger.getLedger();
const spent = ledger!.totalBalance - after.totalBalance;

log('wrote fixtures/og/signer.json + fixtures/og/run-1.json');
log(`ledger after : ${ethers.formatEther(after.totalBalance)} OG (this call ~${ethers.formatEther(spent)} OG)`);
log(`does the signed text cover the output: ${signedCoversOutput}`);
