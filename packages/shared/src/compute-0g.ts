// compute-0g.ts — the REAL 0G Sealed Inference backend (called from inside the enclave).
//
// BUILD-PLAN P3-B/4: the 0G signature is verified INSIDE THE ENCLAVE; the contract trusts
// that flag. When it cannot be verified, `ogVerified: false` is written — never silently
// true.
//
// WHAT THE SIGNATURE COVERS (measured in P0-B, CLAUDE.md §3.1):
//     "<h1>:<sha256(raw response body)>:<ProviderType>:<ProviderIdentity>:<h3>"
// That is why verification takes TWO steps, and both are required:
//   (a) verifyMessage(tuple, signature) === expected signer
//         → a genuine 0G TEE signed SOMETHING
//   (b) sha256(raw response) appears in the tuple
//         → what it signed is OUR response
// If (a) alone were enough, an attacker could hand us a valid TEE signature belonging to a
// different request and call it proof. (b) closes that door.
//
// NETWORK EGRESS: this module only reaches the 0G RPC and the selected provider's endpoint
// (a P3-B criterion — so as not to pollute the `imageHash` claim).

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyMessage } from 'ethers';

import type { ComputeBackend, ComputeRequest, ComputeResult } from './compute.js';
import { recordRun, computeRequestKey } from './compute-fixture.js';

// The SDK's ESM build is broken in v0.9.0 (lib.esm/index.mjs pulls named exports from a CJS
// chunk → SyntaxError). The CJS build is sound.
const require = createRequire(import.meta.url);

export interface ZeroGBackendOptions {
  rpcUrl: string;
  /** The key of the wallet paying for 0G. It NEVER leaves the enclave. */
  privateKey: string;
  /** Pinned provider. When empty, the cheapest acknowledged TeeML provider is selected. */
  providerAddress?: string;
  /** Record every real call here (P0-D/4 fixture discipline). No recording when empty. */
  recordDir?: string;
  /** Call ceiling — so the enclave does not wait forever if the provider stalls. */
  timeoutMs?: number;
}

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

/** The P0-G budget is 60 s; we take half of that as the ceiling for a single call. */
const DEFAULT_TIMEOUT_MS = 30_000;

const IMAGE_MODEL_HINT = /image|vision|diffusion/i;

/** Work out from `additionalInfo` which address the signature should belong to. */
function resolveExpectedSigner(svc: Service): string {
  if (!svc.additionalInfo) return svc.teeSignerAddress;
  try {
    const info = JSON.parse(svc.additionalInfo) as {
      ProviderType?: string;
      TargetSeparated?: boolean;
      TargetTeeAddress?: string;
    };
    const centralized = (info.ProviderType ?? 'decentralized') === 'centralized';
    // If it is separated and NOT centralized, the model runs in its own enclave and signs
    // there; with a centralized provider the broker TEE signs.
    if (info.TargetSeparated === true && !centralized && info.TargetTeeAddress) {
      return info.TargetTeeAddress;
    }
  } catch {
    // If additionalInfo is malformed we fall back to the address in the contract — we do not
    // invent one.
  }
  return svc.teeSignerAddress;
}

/** Turn brief + data + constraints into the single prompt sent to the model. */
/**
 * LEVEL 0 BINDING: when `commitment` is supplied the instruction goes at the VERY TOP of the
 * prompt. Putting it at the end creates two risks at once — `max_tokens` may truncate a long
 * answer, and the model may lose track of the instruction after a long generation. At the
 * top it held 5/5 (scripts/og-probe-echo.ts).
 *
 * The instruction says "copy character for character": in a 64-digit hex value a one
 * character shift breaks the binding, and "approximately right" is useless here.
 */
function buildPrompt(request: ComputeRequest): string {
  const head = request.commitment
    ? [
        `ORDER-ID: ${request.commitment}`,
        '',
        'Begin your reply with exactly this line, copied character for character:',
        `ORDER-ID: ${request.commitment}`,
        '',
        'Then answer the brief below.',
        '',
      ]
    : ['You are an expert analyst. Produce the deliverable described in the brief.', ''];

  return [...head, `BRIEF:\n${request.brief}`, '', `DATA:\n${request.data}`].join('\n');
}

export function createZeroGComputeBackend(options: ZeroGBackendOptions): ComputeBackend {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Broker setup is expensive (chain reads) — build it on the first call and keep it.
  let ready: Promise<{ broker: any; svc: Service; expectedSigner: string }> | undefined;

  async function init() {
    const { ethers } = await import('ethers');
    const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

    const provider = new ethers.JsonRpcProvider(options.rpcUrl);
    const wallet = new ethers.Wallet(options.privateKey, provider);
    const broker = await createZGComputeNetworkBroker(wallet);

    // CAREFUL: the inference-side signature is (offset, limit, includeUnacknowledged) and the
    // contract caps limit at 50. The return value is a frozen ethers Result.
    const services: Service[] = Array.from(await broker.inference.listService(0, 50, true));

    let picked: Service | undefined;
    if (options.providerAddress) {
      picked = services.find((s) => s.provider.toLowerCase() === options.providerAddress!.toLowerCase());
      if (!picked) throw new Error(`0G provider not in the list: ${options.providerAddress}`);
    } else {
      const eligible = Array.from(
        services.filter(
          (s) => s.verifiability === 'TeeML' && s.teeSignerAcknowledged && !IMAGE_MODEL_HINT.test(s.model),
        ),
      );
      if (eligible.length === 0) throw new Error('no acknowledged TeeML text provider available');
      picked = eligible.sort((a, b) => Number(a.outputPrice - b.outputPrice))[0];
    }
    if (!picked) throw new Error('could not select a 0G provider');
    const svc: Service = picked;

    // TeeTLS does not carry the "the operator cannot see the data" claim — we do not accept it.
    if (svc.verifiability !== 'TeeML') {
      throw new Error(`provider is not TeeML: ${svc.verifiability}`);
    }
    // When unacknowledged, teeSignerAddress is the provider's own claim and the contract has
    // not vouched for it.
    if (!svc.teeSignerAcknowledged) {
      throw new Error(`the provider's TEE signer is not acknowledged in the contract: ${svc.provider}`);
    }

    return { broker, svc, expectedSigner: resolveExpectedSigner(svc) };
  }

  return {
    provider: '0g-sealed-inference',

    async run(request: ComputeRequest): Promise<ComputeResult> {
      ready = ready ?? init();
      const { broker, svc, expectedSigner } = await ready;

      const { endpoint, model } = await broker.inference.getServiceMetadata(svc.provider);
      // Headers are SINGLE-USE — fetched again for every request.
      const headers = (await broker.inference.getRequestHeaders(svc.provider)) as Record<string, string>;

      const body = {
        model,
        messages: [{ role: 'user', content: buildPrompt(request) }],
        max_tokens: request.constraints.maxTokens,
      };

      const started = Date.now();
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        throw new Error(`0G call failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
      }

      // We keep the RAW body: the signature is over sha256(raw body). Parsing the JSON and
      // stringifying it again depends on key order and would break silently the day the
      // provider reorders its fields.
      const rawResponseText = await res.text();
      const completion = JSON.parse(rawResponseText) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: Record<string, number>;
      };
      const output = completion.choices?.[0]?.message?.content ?? '';

      // chatID is NOT `completion.id`: the signature server recognises the id in the
      // `ZG-Res-Key` header and answers "chat_id_not_found" for the other one.
      const chatId = res.headers.get('ZG-Res-Key') ?? undefined;

      // --- SIGNATURE: INSIDE THE ENCLAVE, in two steps ---
      let ogSig: string | undefined;
      let ogSigner: string | undefined;
      let ogVerified = false;

      if (chatId) {
        try {
          const sigRes = await fetch(
            `${svc.url}/v1/proxy/signature/${chatId}?model=${svc.model}`,
            { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) },
          );
          if (sigRes.ok) {
            const sig = (await sigRes.json()) as { text: string; signature: string };
            ogSig = sig.signature;

            // (a) did a genuine TEE sign something?
            ogSigner = verifyMessage(sig.text, sig.signature);
            const signerOk = ogSigner.toLowerCase() === expectedSigner.toLowerCase();

            // (b) is what it signed OUR response?
            const digest = createHash('sha256').update(rawResponseText).digest('hex');
            const coversThisResponse = sig.text.split(':').includes(digest);

            ogVerified = signerOk && coversThisResponse;

            if (signerOk && !coversThisResponse) {
              // Valid signature + a different response = exactly the attack we want to block.
              throw new Error(
                'VALID TEE signature but it belongs to a DIFFERENT response — this response\'s sha256 is not in the tuple',
              );
            }

            if (ogVerified && options.recordDir) {
              recordRun(options.recordDir, {
                request: { endpoint, model, prompt: buildPrompt(request) },
                rawResponseText,
                output,
                latencyMs,
                chatID: chatId,
                signature: sig,
                verification: { expectedSigner, responseSha256: digest },
                requestKey: computeRequestKey(request),
              });
            }
          }
        } catch (err) {
          // The signature could not be fetched or did not check out: `ogVerified` stays false.
          // The output is still returned, because the enclave does not lie — it REPORTS THE
          // GAP (the P3-B rule).
          ogVerified = false;
          if (err instanceof Error && err.message.startsWith('VALID TEE signature')) throw err;
        }
      }

      return {
        output,
        ogSig,
        ogSigner,
        ogVerified,
        provider: '0g-sealed-inference',
        commitmentRequested: Boolean(request.commitment),
        chatId,
        latencyMs,
      };
    },
  };
}
