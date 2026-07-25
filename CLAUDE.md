# CLAUDE.md — Confidential Agents · Build Instructor

> **This file is the master context for Claude Code.** Read it fully before doing anything.
> It contains the project, the *confirmed* technical spec, the toolchain, environment setup,
> and the phase-by-phase build plan. When in doubt, follow this file over your priors.
>
> **ETHGlobal Lisbon 2026 · 2-person team · TypeScript · 100% testnet · Tracks: 0G · The Graph · Hedera**

---

## 0. START HERE — what to do first

When the user says "set up the environment", execute **§6 Environment Setup** step by step,
then run **Phase 0 (§8)** — the de-risk spike — before writing any feature code. Do **not**
build features until P0 is green. Ask the user to fund faucets when required (you cannot fund wallets).

Golden rules:
- **Riskiest first.** Prove 0G TEE + Hedera x402 + the intent-binding before anything depends on them.
- **Honesty in code & README.** Never let the code or docs claim more than §11 allows.
- **Confirm, don't assume.** The open questions in §10 gate the design — resolve them in P0.

---

## 1. The project

Two independent AI agents — **Alice** (client) and **Bob** (expert analyst) — discover each other
through a public **ERC-8004** registry, then keep the whole relationship private: what was said,
who was paid, and the work itself. The result is verifiable on-chain, and it is provably
*the job Alice ordered*.

**Thesis (the differentiator):** payment, execution and reputation are each solved for agents, but
nothing connects them. We carry **one signed intent hash** from payment, through the enclave, to
reputation — **intent-bound verification**. 0G attests the compute; we attest the intent.

**Three confidential capabilities** (independent lego pieces):
1. **Confidential messaging** — task + data ECIES-encrypted to the recipient's pubkey.
2. **Confidential payment** — x402; on the Base run the recipient is unlinkable (stealth).
3. **Confidential work (HERO)** — the model runs in a 0G Sealed Inference enclave; infra can't see the data; output is TEE-signed.

**Product surface:** a runnable **demo-dApp** (not a marketplace) showing one confidential job
end-to-end + a live on-chain fraud rejection. A reusable MCP/SKILL ships as bonus, not as the identity.

---

## 2. Architecture — Level 1 (two TEEs, one binding)

```
Alice-agent (alice-agent.ts)                     Bob's Tapp = TEE #1 (agent-wrapper)
  - discover via The Graph            ECIES/HTTP    - decrypt {intentHash, brief, data}
  - sign EIP-712 intent          ───────────────▶   - recompute keccak256 → match?
  - ECIES-encrypt brief+data                         - call 0G Sealed Inference (TEE #2) ──▶ model
  - pay (Base-stealth / Hedera)                      - verify 0G output signature
  - verify result + settle       ◀───────────────    - sign {intentHash,outputHash,match,ogSig}
                                                      - encrypted memory → 0G Storage (bonus)
Verifier.sol (Base Sepolia): verify Tapp seal-key sig + Alice EIP-712 intent + match==true
  → emit JobVerified(intentHash, outputHash) → settlement releases AFTER this (x402 verify/settle split)
```

**Why Level 1:** the model runs in **0G Sealed Inference** (satisfies the 0G track's "use 0G Compute for
inference"); the intent-**binding** runs in **Bob's own attested Tapp**. The binding does NOT require the
model to be co-located — Bob's Tapp only does hashing + orchestration (light, fits any CPU TEE).

### 2.1 WHAT WE ACTUALLY SHIPPED — Level 0+ (no TDX host was available)

Level 1 needs a TDX machine for Bob's Tapp. 0G does not host Tapp execution for us and we have none,
so the recompute runs as ordinary (unattested) code. Rather than fake an attestation, we moved **one
end of the binding inside 0G's real enclave** — the §12 Level 0 fallback, implemented and measured:

```
Alice signs intentHash  →  it is placed at the TOP of the prompt
                        →  model copies it verbatim into its answer
                        →  0G TEE signs sha256(response body) which CONTAINS that answer
⇒ a genuine 0G enclave has attested: "a response carrying THIS intentHash was produced in here"
```

Bob cannot forge that chain on his own machine — the first link comes from 0G hardware.
Measured 5/5 verbatim (`scripts/og-probe-echo.ts`), gated in `gate:P3-B`, surfaced as `intentEchoed`.

The echo is checked by `runBinding` against the raw output, **not** by the compute backend — a backend
could claim it inserted the commitment. Verification is exact-match on the full 64-hex value; one
shifted character breaks it, and "close enough" is not a category.

**Not verifiable on-chain, by design:** the TEE signs the digest of the response body, so checking the
echo requires the body itself. `Verifier.sol` therefore still verifies `match`; the echo is the
independently-verifiable strengthening for anyone holding the response (Alice, and the demo's
verification panel). No contract change, no redeploy.

**What a TDX host would have added** (say this in the presentation — it is the honest delta):
with our own attested enclave, the *recompute itself* would be inside the seal, so the attestation
would read `codeDigest + inputHash + outputHash` (cf. Oasis ROFL) and a third party could trust
`match` without trusting us. Today `match` is computed by unattested code; the client can verify it
independently, a stranger cannot. That one sentence is the whole gap — nothing else in the pipeline
changes.

**Clean separation** (answer to "which chain is the source of truth?"):
**Base = the verdict · Hedera = the timeline · The Graph = the read layer · 0G = the compute.** No layer duplicates another.

---

## 3. Confirmed technical spec (verified from source — do not re-derive)

### 3.1 The two signatures (both ecrecover-compatible)

**A) 0G Sealed Inference signature** (proves a genuine 0G TEE produced the *output*):
- Verify: `recoverAddress(hashMessage(text), signature) === teeSignerAddress` (ethers).
- **EIP-191** personal_sign style. **Forwardable** + standalone-verifiable. `chatID` ties output↔request
  only in 0G's own ledger.
- **CORRECTED IN P0-B (measured, not assumed).** The signed message is **NOT the output text**. It is a
  pipe-free, colon-joined tuple:
  ```
  "<h1>:<sha256(raw response body)>:<ProviderType>:<ProviderIdentity>:<h3>"
  ```
  So the output IS covered — as the **fingerprint (sha256 digest) of the body that contains it**, not as
  plain text. Verified by hashing every candidate against each digest; only the raw-body sha256 matched.
  A one-byte change to the body drops out of the tuple (gate `P0-B` asserts this).
  → **Hash the RAW response bytes.** A `JSON.parse`→`JSON.stringify` round-trip depends on key order and
  breaks silently the day the provider reorders fields.
- `chatID` comes from the **`ZG-Res-Key` response header**, not `completion.id` (the latter yields
  `chat_id_not_found` from the signature endpoint).
- **TeeML is necessary but not sufficient:** also require `teeSignerAcknowledged === true` on the service
  struct. When false, `teeSignerAddress` is the provider's own claim, the contract owner has not vouched
  for it, and `processResponse` refuses to verify.

**B) Bob's Tapp seal-key signature** (proves Bob's attested code checked `match` and bound intent→output):
- Preimage: `keccak256("agentId|sealId|timestamp|hex(sha256(body))")` — a pipe-joined ASCII string;
  the body is `sha256`'d first, hex-encoded, then folded into the string, then `keccak256` is signed.
- **No EIP-191 prefix.** secp256k1. Signature is **64-byte R‖S — `v` is discarded** by the wrapper.
  → **brute-force `v ∈ {27,28}` off-chain**, pass `v` into the contract.
- The signer is an **ephemeral `agentSealKey`**, issued once per container run — **NOT** Bob's `agentId`.

### 3.2 Seal-key registration (do this at setup, keep it mutable)
1. Boot Bob's Tapp for the demo window; avoid restarts.
2. Capture one live signed response → run `scripts/recover.js` → get the real signer address.
3. Optional cross-check vs `GetAgentMetadata(agentId).agentSeal` (a flag, not ground truth).
4. Owner-only `setEnclaveSigner(agentId, addr)` once. **Keep the setter mutable** for the 36h window
   (infra may restart the container → new key → re-register).

### 3.3 The trust anchor — `imageHash`
The Attestor provisions the seal key bound to an `imageHash`. **At setup, verify
`imageHash == hash(our published Bob image)`.** That is what makes "the enclave ran *our* recompute
code" true — the whole thesis rests on this check.

### 3.4 Intent construction (Alice, EIP-712)
```
intentHash = keccak256(abi.encode(briefHash, dataHash, constraints, price, nonce))
```
Alice signs `intentHash` with EIP-712. The contract recovers **Alice's own** signer and compares to the
registered client (never trust an intent+output pair Bob supplies).

### 3.5 Verifier.sol (Base Sepolia) — required logic
- `mapping(string => address) enclaveSignerOf;` + owner-only `setEnclaveSigner(agentId, signer)`.
- `verifyJob(...)`: (a) reconstruct the Tapp preimage, recover signer (caller supplies `v`), require
  `== enclaveSignerOf[agentId]`; (b) recover Alice's EIP-712 signer, require `== registeredClient`;
  (c) `require(match == true)`; then `emit JobVerified(intentHash, outputHash)`.
- The Tapp verifies 0G's output sig internally (it is attested); the contract trusts that flag. Carry
  `ogSig` in the body for the demo's independent-verification panel.

---

## 4. Tech stack & dependencies

**Runtime:** Node 20+, TypeScript, pnpm (or npm) workspaces monorepo. Solidity via Foundry or Hardhat.

```bash
# --- 0G ---
npm i @0gfoundation/0g-compute-ts-sdk    # Sealed Inference broker (TeeML)
npm i @0gfoundation/0g-ts-sdk            # 0G Storage (client-side AES-256)
# reference: github.com/0glabs/0g-compute-ts-starter-kit , github.com/0gfoundation/agent-wrapper

# --- Hedera ---
npm i @hiero-ledger/sdk @hashgraph/hedera-agent-kit @hashgraph/hedera-agent-kit-langchain
npm i @x402/hedera @hashgraphonline/standards-sdk   # x402 exact scheme + HCS-14 UAID
npm i -g @hiero-ledger/hiero-cli                     # hcli

# --- The Graph ---
npm i -g @graphprotocol/graph-cli

# --- Core protocol ---
npm i ethers eth-crypto viem
# stealth: an ERC-5564 lib (e.g. @scopelift/stealth-address-sdk) for the Base backend
```

Key facts baked into the stack:
- **0G Sealed Inference:** `createZGComputeNetworkBroker(wallet)` → `getServiceMetadata` (pin a **TeeML**
  provider) → `getRequestHeaders` → POST `/chat/completions` → `processResponse`.
- **Hedera x402:** `@x402/hedera` exact scheme; facilitator **blocky402 testnet** =
  `https://api.testnet.blocky402.com` (no API key), advertised `feePayer 0.0.7162784`; HBAR in **tinybars**.
- **Hedera HCS timeline:** use `HcsAuditTrailHook` from `@hashgraph/hedera-agent-kit/hooks` **or** a plain
  `TopicMessageSubmitTransaction`. Commit only hashes/commitments; content stays encrypted.
- **The Graph:** fork the **agent0lab** subgraph, deploy **live** to Subgraph Studio; index the ERC-8004
  registry (discovery) + your own `JobVerified` events (verified-delivery count).

---

## 5. MCP servers & skills to install into Claude Code

Add these to the project so the coding agent has expert tooling:

```jsonc
// .mcp.json (project-scoped MCP servers)
{
  "mcpServers": {
    "hedera-docs":   { "url": "https://docs.hedera.com/mcp" },
    "hedera-agent":  { "command": "npx", "args": ["-y", "@hashgraph/hedera-agent-kit-mcp"] },
    "thegraph":      { "command": "uvx", "args": ["subgraph-mcp"], "env": { "THEGRAPH_API_KEY": "..." } }
  }
}
```

Skills (Claude Code plugins):
```bash
# The Graph — subgraph dev/optimization/testing expertise (use this when building the subgraph)
#   repo: github.com/graphprotocol/subgraphs-skills   (add as a Claude Code plugin)
# Hedera — HTS/HCS/contract code-gen skills
npx skills add hedera-dev/hedera-skills --all
```

Note: **0G has no first-party MCP/skill** — work from its SDKs + starter kits (github.com/0glabs/0g-compute-ts-starter-kit).

---

## 6. Environment setup (run these in order)

1. **Scaffold the monorepo** (§7 structure). Init pnpm workspaces + TypeScript + Foundry/Hardhat.
2. **Create `.env`** from the template below. Generate throwaway keys; never commit `.env`.
3. **Ask the user to fund faucets** (you cannot):
   - 0G: `faucet.0g.ai` / `hub.0g.ai/faucet` — **0.1 OG/day is the binding constraint; fund first.**
   - Hedera testnet: `portal.hedera.com` (100 HBAR/24h).
   - Base Sepolia: any Base Sepolia faucet.
4. **Install deps** (§4). **Wire MCPs/skills** (§5).
5. **Run Phase 0** (§8) and stop at its exit criteria.

```dotenv
# .env  (NEVER commit)
# --- keys (throwaway) ---
ALICE_PRIVATE_KEY=
BOB_PRIVATE_KEY=
DEPLOYER_PRIVATE_KEY=
# --- 0G ---
ZG_RPC_URL=
ZG_COMPUTE_PROVIDER=            # a TeeML provider address (confirm in P0)
# --- Hedera ---
HEDERA_ACCOUNT_ID=
HEDERA_PRIVATE_KEY=
HEDERA_NETWORK=testnet
X402_FACILITATOR_URL=https://api.testnet.blocky402.com
# --- Base Sepolia ---
BASE_SEPOLIA_RPC_URL=
ERC8004_REGISTRY_ADDR=
VERIFIER_ADDR=                  # filled after deploy
# --- The Graph ---
THEGRAPH_API_KEY=
SUBGRAPH_STUDIO_DEPLOY_KEY=
```

---

## 7. Repo structure

**pnpm workspace monorepo.** `pnpm-workspace.yaml` declares `packages/*`, `subgraph` and `web`.

`packages/` holds the **libraries and agents** — the things that import each other and build as one
`tsc -b` graph. The two deliverables that are nobody's dependency sit at the root next to
`contracts/`: `subgraph/` and `web/`. Membership of the workspace is declared per entry, so being a
package has never required living under `packages/` — `subgraph/` was at the root from the start,
and `web/` now matches it. A monorepo's top level should read as a list of what the project *is*,
and "the demo dApp" belongs on that list.

`scripts/` and `tests/` carry a package.json too, but purely as a `"type": "module"` marker (the
root stays CJS so `scripts/recover.js` keeps working); they are deliberately NOT workspace members,
which is why everything under them imports by relative path rather than by package name.

```
packages/
  shared/           # @ca/shared — the library every agent imports
    src/intent.ts       # EIP-712 intentHash build + sign
    src/ecies.ts        # ECIES encrypt/decrypt (eth-crypto)
    src/identity.ts     # ERC-8004 register/read
    src/discovery.ts    # The Graph query (skill + verified-delivery rank)
    src/compute-0g.ts   # 0G Sealed Inference broker + processResponse
    src/compute-select.ts # 0G vs fixture backend switch
    src/ogsig.ts        # verify the 0G TEE signature (§3.1 A)
    src/sealsig.ts      # seal-key preimage + brute-v recover (§3.1 B)
    src/canonical.ts    # byte-stable JSON — the wrapper signs raw bytes
    src/storage.ts      # 0G Storage encrypted upload/download (bonus)
    src/timeline.ts     # HCS commitments
  payment/          # @ca/payment — PaymentBackend, one file per backend
    src/base-stealth.ts # x402 + ERC-5564 stealth on Base Sepolia (privacy run)
    src/hedera-x402.ts  # @x402/hedera + blocky402 (agentic run)
    src/hcs-timeline.ts # HCS timeline for the Hedera run
    src/signer/         # delegated signing — the key never enters agent context
  bob-binding/      # @ca/bob-binding — the binding agent (was /tapp)
    src/chat.ts         # /chat: decrypt → recompute keccak256 → match → 0G SI → verify ogSig
    src/binding.ts      # runBinding: checks the intentHash echo against the RAW output
    Dockerfile          # NOTE: no TDX host, so this image is not measured (§2.1)
  bob-agent/        # @ca/bob-agent — public HTTP server: 402, forwards work to the binding
    src/fraud.ts        # the flag that makes Bob answer a different job (§8 P3)
  alice-agent/      # @ca/alice-agent — discovers, signs intent, encrypts, pays, verifies
  demo/             # @ca/demo — runDemo(): the end-to-end flow as a library (CLI + dashboard share it)
web/                # @ca/web — the demo dApp (Next.js, sources under src/)
  src/app/            # App Router: landing page + /dashboard + /api route handlers
  src/components/dashboard/  # the five panels (§8 P5-A)
  src/lib/server/     # subgraph, mirror node, the live runner — server-only
  public/hero/        # hero stills — at the package root, NOT src/, or Next won't serve them
contracts/          # Foundry — Verifier.sol + IntentLib.sol (§3.5), and their tests
subgraph/           # @ca/subgraph — ERC-8004 index + JobVerified → verified-delivery count
scripts/            # deploy + probes + measurement (recover.js, og-probe-echo.ts, measure-e2e.ts)
tests/gates/        # one file per phase gate; run via `pnpm gate:P3-B` etc.
fixtures/           # recorded responses, so gates run without burning faucet funds
```

**Build.** The root `tsc -b` solution build covers the Node packages only — a Next.js project does not
belong in a `tsc -b` graph, so `web` is not among the root `tsconfig.json` references and
`pnpm build` does not touch it. Use **`pnpm build:all`** to build everything, or
`pnpm --filter @ca/web <script>` to work on the web app alone.

---

## 8. Build phases (do in order; each depends on the previous)

### Phase 0 — De-risk spike (STOP at exit criteria)
- (a) One 0G Sealed Inference call + `processResponse` verify + **capture `teeSignerAddress`**.
- (b) Confirm the **binding path**: deploy a trivial custom agent to a Tapp that returns a hash it
      computed; verify the wrapper signs the full body and `recover.js` recovers the seal key. (See §10.)
- (c) Fund faucets; **measure** how many inference calls + storage uploads 0.1 OG/day buys.
- (d) Run `@x402/hedera` end-to-end once on Hedera testnet via blocky402 (`402 → pay → 200`).
- (e) ERC-8004 register + read on Base Sepolia.
- **Exit:** all legs green **and end-to-end latency < 60s** (Alice → Tapp → 0G SI → sign → return).
- **Fallback:** only after a leg is proven dead — mock the TEE sig (honest label) / plain x402 / drop Storage.

### Phase 1 — Messaging + intent
Two agent servers + `/task` `/result` + ECIES wrapper + agent-card/pubkey schema + **Alice EIP-712 intent signing**.

### Phase 2 — Identity + discovery → unlocks The Graph
ERC-8004 registration (skill, endpoint, ECIES pubkey); fork + deploy agent0lab subgraph **live** to
Subgraph Studio; discover by skill. **Bonus:** index `JobVerified` → verified-delivery count; Subgraph MCP + SKILL.

### Phase 3 — Compute + intent-bound verification → unlocks 0G (HERO)
Build `/tapp/chat.ts` (the binding agent) + deploy to the agent-wrapper Tapp; verify `imageHash` + register
seal key; deploy `Verifier.sol` (dual-sig). **Build the fraud path** (a flag makes Bob answer a different job →
contract rejects live). **Bonus:** 0G Storage encrypted memory (only if P0(c) allows).

### Phase 4 — Payment + timeline → unlocks Hedera
`PaymentBackend` ×2 (base-stealth, hedera-x402). **Settle after `JobVerified`.** HCS records the off-chain
timeline (commitments only). **Bonus:** delegated signing (key never enters agent context) + HCS-14 UAID.

### Phase 5 — Product + submissions
Demo-dApp (5 panels incl. fraud + independent-verify); 3 videos (<3min 0G, 2–4min Graph, ≤5min Hedera);
one README per sponsor naming exact SDKs, endpoints, contract addresses.

---

## 9. Coding conventions
- TypeScript strict. Small, testable modules. No secrets in code — everything via `.env`.
- Keep the **payment layer swappable** behind `PaymentBackend`; the demo toggles Base vs Hedera.
- The Tapp response body must be **byte-stable** (deterministic JSON) — the wrapper signs raw bytes;
  never re-stringify before verifying. Match Solidity by using **keccak256** (not sha256) where the contract expects it.
- Delegated signing: the payment private key lives in the signer/`.env`, **never** in agent/LLM context.
- Write a unit test for every crypto boundary (intent hash, preimage reconstruction, ecrecover with brute-v).

---

## 10. Open questions to resolve in P0 (these gate the design)
1. **Tapp hosting / TDX:** does 0G host Tapp execution, or must we bring our own TDX host? If self-host →
   hosted TDX node or Alibaba credits. (Ask the 0G mentor. If unavailable in time → Level 0 fallback: hosted
   Sealed Inference only + echo intentHash, binding labelled app-level.)
2. **TeeML vs TeeTLS:** which providers are TeeML; how to get `teeSignerAddress`.
3. **Seal-key stability / imageHash:** does `agentSealKey` rotate on restart; how to verify `imageHash` at setup.
4. **Contracts location:** is `Verifier.sol` on Base Sepolia acceptable, or does 0G want it on 0G Chain?
5. **Latency:** which model + typical sealed-inference latency for a ~6-page analysis (need < 60s).

---

## 11. Honest boundaries — claims the code/README must NOT exceed
- **Not** "Sybil-proof reputation" — it is feedback anchored to paid, verified jobs; inflation is expensive, not impossible.
- **Not** "solves prompt injection" — the binding catches **task substitution + input tampering** only.
- **Not** "first confidential agent payments" — ProwlFi / TACEO shipped before us.
- **Not** "private on Hedera" — the Hedera run buys **autonomy**, not privacy (stealth is on the Base run).
- **Not** "we built the TEE" — 0G did; we bind it to intent.
- **Not** "the 0G signature covers the answer text" — it covers the answer's **fingerprint** (see §3.1).
  Same guarantee against tampering, different sentence. Use the accurate one.
- **Not** "the enclave verified that the job matches the order." The enclave attests that a response
  carrying this `intentHash` was produced inside it. Whether that hash really is the hash of *this*
  brief+data is checked by **unattested** code — the model copies the value, it does not validate it.
  Say: *"0G attests the compute and carries the intent through it; the match check is client-verifiable,
  not yet third-party-verifiable."* (§2.1)
- **Not** "two TEEs." One: 0G's. Bob's binding runs on an ordinary host because no TDX was available.
  `attestation: 'none'` and `imageHash: null` stay honest until P0-C/P3-C land.
- **Not** "decentralized compute" for the provider we pinned: `0xa48f…7836` reports
  `ProviderType: centralized`, `ProviderIdentity: aliyun`. The TEE seal is real (dstack/Intel TDX); the
  operator is a single cloud. If asked, say so plainly.
- We verify signatures **on-chain** and the attestation **off-chain at setup** (not a raw on-chain TDX quote). Say so.
- **Not** "the AI decided, therefore it is trustworthy." The agents' brain (§13) picks the counterparty and
  approves the price; it is **unverified, unattested, and outside every guarantee we make**. Nothing it
  says is signed by anything. It can only ever *narrow* an outcome — refuse to trade, or reject work the
  cryptography accepted. It cannot make an invalid job verify. If the brain and the contract disagree,
  the contract is the one that decided.
- **Not** "Claude runs the analysis." Claude decides; **0G Sealed Inference produces the deliverable.**
  The TEE signature and the `intentHash` echo come from 0G hardware and from nowhere else. Swapping the
  brain cannot change one byte of what the enclave signed.

---

## 12. Fallbacks (only after a leg is proven dead)
- 0G signature covers output only (confirmed) → binding lives in our Tapp (Level 1). If no Tapp/TDX access →
  Level 0 (echo intentHash in the model output), label as app-level.
- 0G faucet can't carry compute + storage → drop Storage bonus, keep the hero.
- Seal key rotates mid-demo → re-run capture + `setEnclaveSigner` (setter kept live).
- Stealth scanning messy → plain x402 on the Base run.
- Hedera facilitator down → the Base backend carries the whole demo.
- Brain unavailable mid-demo (rate limit, expired login, no network) → `withPolicyFallback` answers
  deterministically and the dashboard shows `fellBackFrom`. The run never dies for want of an opinion.

---

## 13. The agents' brain — who DECIDES (vs. who COMPUTES)

Alice and Bob are agents in the ERC-8004/x402 sense — own identity, own wallet, own decisions — and
since P5 those decisions are made by a model rather than by a sort order. **This is a separate axis
from compute and is labelled separately:** `computeProvider` says who produced the deliverable,
`reasoningProvider` says who chose. The dashboard shows both, because they are different questions.

```
packages/shared/src/
  reasoning.ts          # the interface, the policy brain, withPolicyFallback, the three WALLS
  reasoning-prompts.ts  # the prompts + the tiny JSON output contract (shared by both LLM brains)
  reasoning-llm.ts      # the decision logic + guards, ONCE, transport-independent
  reasoning-claude.ts   # transport: `claude -p --output-format json` (subscription auth)
  reasoning-0g.ts       # transport: the ordinary ComputeBackend (spends the faucet)
  reasoning-select.ts   # REASONING_BACKEND=claude | 0g | policy   (default: policy)
```

**Three decisions.** Alice picks who to hire from the subgraph's shortlist (binding), approves or
refuses the quoted price (binding — a refusal ends the job and no money moves), and judges whether the
delivered work was any good (advisory, shown in the UI).

**Three walls — the reason autonomy does not cost us the thesis.** Each is enforced in code, in
`reasoning-llm.ts`, never in a prompt:
1. **The model being sold is not this model.** The deliverable runs in 0G Sealed Inference. Reasoning
   never produces output that anything signs.
2. **The brain never sees a private key.** Decisions return as small structured verdicts; signing,
   paying and settling stay in deterministic code. The spawned CLI's environment is scrubbed of every
   secret (`scrubbedEnv`) — "it was never given it" beats "it could not have used it".
3. **The brain can only narrow a guarantee, never widen one.** `chooseAgent` must name a candidate
   that was actually offered. `approvePrice` is ANDed with a hard ceiling the prompt cannot move.
   `reviewResult` may reject work the cryptography accepted, and can never accept work whose
   commitment failed. A confused — or prompt-injected — brain can refuse to trade. It cannot overpay,
   invent a counterparty, or make an invalid job verify.

**Default is `policy`, on purpose:** a gate whose outcome depends on a model's mood, a network round
trip and a rate limit is not a gate. The gates run deterministic; the demo opts in via `.env`.

**Latency cost, measured:** ~8.5s for the hire decision, ~7.1s for the review, on `sonnet`. That lands
on the P0-G <60s end-to-end budget, so if the budget gets tight the lever is `CLAUDE_AGENT_MODEL=haiku`
before anything else is cut.
