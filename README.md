# Confidential Agents — ETHGlobal Lisbon 2026

Two independent AI agents — **Alice** (client) and **Bob** (expert analyst) — discover each other
through a public **ERC-8004** registry, then keep the whole relationship private: what was said,
who was paid, and the work itself. The result is verifiable on-chain, and it is provably *the job
Alice ordered*.

**The thesis.** Payment, execution and reputation are each solved for agents; nothing connects
them. We carry **one signed intent hash** from the payment, through the enclave, into the verdict
— *intent-bound verification*. 0G attests the compute; we attest the intent.

**Tracks:** 0G · The Graph · Hedera. 100% testnet.

| | |
|---|---|
| 0G track write-up | [`docs/0g.md`](./docs/0g.md) |
| The Graph track write-up | [`docs/the-graph.md`](./docs/the-graph.md) |
| Hedera track write-up | [`docs/hedera.md`](./docs/hedera.md) |
| Full spec & build plan | [`CLAUDE.md`](./CLAUDE.md) · [`BUILD-PLAN.md`](./BUILD-PLAN.md) |
| Verifier contract (Base Sepolia) | [`0x3B116D648B710f551e37223c4c4d39879AFEEb96`](https://sepolia.basescan.org/address/0x3B116D648B710f551e37223c4c4d39879AFEEb96) |
| 0G Sealed Inference provider (Galileo, chainId 16602) | [`0xa48f01287233509FD694a22Bf840225062E67836`](https://chainscan-galileo.0g.ai/address/0xa48f01287233509FD694a22Bf840225062E67836) · model `qwen/qwen2.5-omni-7b` · `TeeML` |
| Job timeline topic (Hedera) | [`0.0.9738448`](https://hashscan.io/testnet/topic/0.0.9738448) |
| Subgraph (The Graph Studio) | `confidential-agents` v0.0.3 — [query it yourself](./docs/the-graph.md#1-query-it-yourself-open-this-first) |
| ERC-8004 agent ids | Bob `8429` · Alice `8431` on [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |

---

## What actually runs

A job goes end to end across four networks, each doing exactly one thing:

**Base = the verdict · Hedera = the money and the timeline · The Graph = the read layer · 0G = the compute.**

```
Alice (client agent)                                Bob (analyst agent)
  discover via The Graph          ── HTTP 402 ──▶     no payment → 402, and NO WORK
  LLM brain picks Bob                                 quote: price, asset, payee
  LLM brain approves the price
  sign EIP-712 intent             ── ECIES ────▶     decrypt {intentHash, brief, data}
  authorize x402 (no money moves)                     recompute keccak256 → match?
                                                      run the model in 0G Sealed Inference
                                                      verify 0G's TEE signature
  verify + decrypt result         ◀── ECIES ────      sign {intentHash, outputHash, match}

  Verifier.sol (Base Sepolia): recover Bob's binding signature + Alice's EIP-712 intent,
  require match == true  →  emit JobVerified

  Bob calls /settle with the JobVerified tx  →  the x402 authorisation is submitted on Hedera.
  A rejected job never reaches this line, and the signed authorisation is never submitted.

  Every stage is committed to a Hedera Consensus Service topic — hashes only, never content.
```

Measured end-to-end latency, 5 runs, no payment rail: **p50 21.0 s, p95 22.7 s** against a 60 s
budget (`fixtures/latency/P0-G.json`, reproduce with `pnpm measure:e2e`). The dominant term is the
0G inference call, ~12.4 s.

### The fraud path is part of the demo

`FRAUD_MODE` makes Bob answer a *different* job, tamper with the input, forge the body he puts on
chain, or supply his own intent. In each case the contract rejects live on Base Sepolia, the
rejection is written to the Hedera topic, and **no money moves** — the settlement guard re-reads
the `JobVerified` receipt before releasing anything. Recorded runs: `fixtures/runs/*.json`.

---

## Status

| Layer | Status | Where |
|---|---|---|
| Intent signing, ECIES messaging, agent servers | ✅ | `packages/shared`, `packages/alice-agent`, `packages/bob-agent` |
| ERC-8004 identity + subgraph discovery | ✅ | [`docs/the-graph.md`](./docs/the-graph.md) |
| 0G Sealed Inference + TEE-signature verification | ✅ | `packages/shared/src/compute-0g.ts`, `ogsig.ts` |
| Intent binding (Level 0 — the hash echoes through 0G's enclave) | ✅ measured 5/5 | `packages/bob-binding/src/binding.ts` |
| `Verifier.sol` dual-signature verdict + the fraud path | ✅ deployed | `contracts/`, `pnpm gate:P3-D` |
| Hedera x402 payment + delegated signing | ✅ | [`docs/hedera.md`](./docs/hedera.md) |
| Hedera HCS job timeline | ✅ | `packages/payment/src/hcs-timeline.ts` |
| Base Sepolia stealth-address rail (recipient privacy) | ✅ | `packages/payment/src/base-stealth.ts` |
| 0G Storage encrypted archive | ✅ | `packages/shared/src/storage.ts` |
| Autonomous reasoning (agents that choose and approve) | ✅ | `packages/shared/src/reasoning*.ts` |
| Demo dApp — five panels, live data | ✅ | `web/` |
| **Per-sponsor submissions** | ✅ all three write-ups | [`0g`](./docs/0g.md) · [`the-graph`](./docs/the-graph.md) · [`hedera`](./docs/hedera.md) |
| **Demo videos** | ⏳ not recorded | — |
| **Hosted demo link** | ⏳ not deployed — runs locally, see below | `web/` |
| Reusable MCP server / SKILL for the registry | ❌ deliberately out of scope | [`docs/the-graph.md` §7.1](./docs/the-graph.md) |
| Bob's binding inside an attested TEE (Level 1) | ❌ no TDX host available | see below |
| HCS-14 UAID bridge | ❌ | [`docs/hedera.md` §7.1](./docs/hedera.md) |

### The one gap we will not paper over

Bob's binding — the code that recomputes the intent hash and decides `match` — runs on an
**ordinary host**, not in an attested enclave. We had no TDX machine and 0G does not host Tapp
execution for us. Rather than fake an attestation, we moved one end of the binding inside 0G's
real enclave: Alice's `intentHash` is placed at the top of the prompt, the model copies it
verbatim into its answer, and 0G's TEE signs the digest of the response body containing it. A
genuine 0G enclave has therefore attested *"a response carrying this intent hash was produced in
here"*, and Bob cannot forge that first link on his own machine.

What that does **not** give you: the `match` check itself is computed by unattested code. Alice
can verify it independently; a stranger cannot. `attestation: 'none'` and `imageHash: null` stay
in the code and in the UI until that changes. The honest sentence is: *0G attests the compute and
carries the intent through it; the match check is client-verifiable, not yet
third-party-verifiable.*

The rest of the boundaries we hold ourselves to are in [`CLAUDE.md` §11](./CLAUDE.md) — read them
before quoting us on anything.

---

## Setup

Requires Node 20+, pnpm 10, and Foundry (for the contracts only).

```bash
pnpm install
cp .env.example .env
pnpm build          # tsc -b over the Node packages
pnpm build:all      # …and the Next.js dApp
```

Fill `.env` — it is validated by zod and tells you exactly which field is missing:

| Group | Fields |
|---|---|
| Base Sepolia | `BASE_RPC_URL`, `PRIVATE_KEY_ALICE/BOB/DEPLOYER`, `ERC8004_IDENTITY`, `USDC_BASE_SEPOLIA`, `VERIFIER_ADDRESS` |
| 0G | `OG_RPC_URL`, `OG_PRIVATE_KEY`, `OG_PROVIDER_ADDRESS` |
| Hedera | `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_NETWORK`, `HEDERA_TOPIC_ID`, `BOB_HEDERA_ACCOUNT`, `BLOCKY402_URL`, `BLOCKY402_FEE_PAYER` |
| The Graph | `SUBGRAPH_QUERY_URL`, `THEGRAPH_API_KEY`, `GRAPH_DEPLOY_KEY` |
| Modes | `PAYMENT_BACKEND=hedera\|base`, `FRAUD_MODE`, `REASONING_BACKEND=claude\|0g\|policy`, `MOCK_0G`, `OG_STORAGE` |

`MOCK_0G=1` replays the recorded 0G responses in `fixtures/og/` — same bytes, same signature, same
verification path — so the gates run with no 0G balance at all. `OG_STORAGE=1` is opt-in because
every job it touches spends faucet credit; when it is off the run reports "no archive" rather than
inventing a root hash.

`HEDERA_OPERATOR_KEY` is validated but never returned by `loadConfig()` — it is read only inside
`packages/payment/src/signer/`. That boundary is tested, not just documented.

Faucets (you will need all three): [0G](https://faucet.0g.ai) ·
[Hedera portal](https://portal.hedera.com) · any Base Sepolia faucet.

## Running it

```bash
pnpm demo:base                                   # a full job, no payment rail
PAYMENT_BACKEND=hedera pnpm demo:base            # …paid on Hedera
PAYMENT_BACKEND=base   pnpm demo:base            # …paid to a stealth address on Base
pnpm demo:base -- --fraud substitute             # rejected on chain, nothing settles
REASONING_BACKEND=claude pnpm demo:base          # …with the agents actually deciding

pnpm --filter @ca/web dev                        # the demo dApp on :3000
```

`REASONING_BACKEND` defaults to `policy` — a deterministic ranking, no model — because a gate
whose outcome depends on a model's mood is not a gate. Set it to `claude` (or `0g`) to see Alice
read the subgraph's shortlist and choose for herself.

Every phase has a gate that proves it against live networks, and the recorded evidence is checked
into `fixtures/` so the gates run without burning faucet funds:

```bash
pnpm gate:P3-D     # the main gate: honest run verifies, all four fraud modes are rejected
pnpm gate:P4-C     # a job paid on Hedera + the delegated-signing proof
pnpm gate:P4-D     # the five-stage HCS timeline, honest run and fraud run
pnpm measure:e2e   # re-measure end-to-end latency
```

Full list: `pnpm run` (gates `P0-A` … `P4-D`).

## Repo layout

```
packages/shared/       intent · ECIES · identity · discovery · 0G compute + signature · reasoning
packages/payment/      PaymentBackend: hedera-x402, base-stealth, hcs-timeline, delegated signer
packages/bob-binding/  decrypt → recompute → match → 0G Sealed Inference → sign
packages/bob-agent/    the public 402 server + the fraud modes
packages/alice-agent/  discover → sign intent → encrypt → pay → verify
packages/demo/         runDemo(): the end-to-end flow, shared by the CLI and the dashboard
web/                   the demo dApp (Next.js) — five panels, live network reads
contracts/             Verifier.sol + IntentLib.sol (Foundry)
subgraph/              ERC-8004 index + JobVerified → verified-delivery count
tests/gates/           one gate per phase · fixtures/ holds their recorded evidence
```

`CLAUDE.md` §7 explains why the workspace is shaped this way.

## Team

| Name | GitHub | Telegram | X |
|---|---|---|---|
| Toygun Tez | [@Zireaelst](https://github.com/Zireaelst) | _TODO before submitting_ | _TODO before submitting_ |
| _teammate_ | _TODO_ | _TODO_ | _TODO_ |

## Developer setup

After cloning, restore the sponsor skills from the checked-in manifest:

```bash
npx skills experimental_install
```

This reads `skills-lock.json` and re-fetches the exact same skill set, verified by hash — no skill
content is vendored in the repo.
