# Hedera — what we built, where it lives, and what we did not build

**Track:** AI & Agentic Payments on Hedera · ETHGlobal Lisbon 2026 · 100% testnet.

This document is the Hedera-specific reading of the project. It is written to be checked: every
claim points at a file, a gate you can run, or a public record you can open without asking us for
anything. The last section is the honest inverse — the track's optional list, minus what we
actually shipped, with the implementation sketch for each gap.

The one-line summary: **Hedera carries the money and the timeline.** Alice pays Bob in HBAR over
the x402 `exact` scheme through the public blocky402 testnet facilitator, and the whole job
lifecycle — from the 402 to the settlement — is written to a Hedera Consensus Service topic as
commitments. The *verdict* that releases the money is given by a contract on Base Sepolia; Hedera
is not asked to duplicate it.

---

## 1. On-chain evidence (open these first)

| What | Value |
|---|---|
| Alice (payer, also the HCS operator) | [`0.0.9695366`](https://hashscan.io/testnet/account/0.0.9695366) |
| Bob (payee) | [`0.0.9738447`](https://hashscan.io/testnet/account/0.0.9738447) |
| Job timeline topic (HCS) | [`0.0.9738448`](https://hashscan.io/testnet/topic/0.0.9738448) |
| A settled job payment | [`0.0.7162784-1784980486-244117925`](https://hashscan.io/testnet/transaction/0.0.7162784-1784980486-244117925) |
| Facilitator (blocky402 testnet, fee payer) | `https://api.testnet.blocky402.com` · `0.0.7162784` |
| The verdict contract (Base Sepolia) | [`0x3B116D648B710f551e37223c4c4d39879AFEEb96`](https://sepolia.basescan.org/address/0x3B116D648B710f551e37223c4c4d39879AFEEb96) |

Read the settled transaction's transfer list and note the shape of it:

```
0.0.9695366  -1,000,000 tinybar   ← Alice pays
0.0.9738447  +1,000,000 tinybar   ← Bob is paid
0.0.7162784    -286,155 tinybar   ← the facilitator pays the fee, not the agents
```

The agent moved value; it did not have to hold gas to do it. That is the x402 facilitator model
working as advertised, on testnet, for a real job.

The captured evidence for both gates is checked into the repo: `fixtures/hedera/P4-C.json` (the
payment, including the raw mirror-node record) and `fixtures/hedera/P4-D.json` (the timeline, both
the honest run and the fraud run).

---

## 2. The payment flow, step by step

Alice and Bob are two separate processes. Neither trusts the other, and the money is released by
neither of them — it is released by a fact on a public chain.

```
 1. DISCOVER    Alice queries the subgraph for agents with the skill she needs.
                Her LLM brain picks one from the shortlist.                       (The Graph)

 2. 402         Alice POSTs /task with no payment.  Bob answers HTTP 402 and
                DOES NO WORK. The body carries price, asset, recipient, network.  (Hedera)
                → HCS: 402_ISSUED

 3. APPROVE     Alice's brain approves or refuses the quoted price. A refusal
                ends the job here and no money moves. The approval is ANDed with
                a hard ceiling in code that no prompt can move.
                → HCS: INTENT_COMMIT

 4. AUTHORIZE   Alice builds a signed x402 `exact` transfer and has the
                facilitator VERIFY it. NO MONEY MOVES. She sends it with the
                encrypted task. Bob checks it really pays HIM, then works.        (Hedera)

 5. WORK        Bob's binding decrypts the task, recomputes the intent hash and
                runs the model in a 0G Sealed Inference enclave.                  (0G)
                → HCS: ENCLAVE_INVOKED, OUTPUT_COMMIT

 6. VERDICT     The dual-signature check runs on Base Sepolia and emits
                JobVerified — or JobRejected.                                     (Base)

 7. SETTLE      Bob calls his own /settle with the JobVerified tx hash. The
                backend re-reads that receipt from Base and only then submits
                the authorisation to the facilitator.                             (Hedera)
                → HCS: SETTLED
```

Three properties of this ordering are worth naming, because they are what makes it an agent
payment rather than a scripted transfer:

- **The 402 gate is real.** `packages/bob-agent/src/index.ts` throws `PaymentRequiredError`
  before any work happens, and `verifyAuthorization` rejects an authorisation made out to someone
  else — you cannot buy Bob's work with a payment addressed to a third party.
- **Verify and settle are split, and the split is enforced against a chain.**
  `assertJobVerified` (`packages/payment/src/guard.ts`) re-reads the `JobVerified` receipt from
  Base Sepolia and matches the `intentHash` inside it before `settlePayment` is ever called. On a
  fraud run the contract emits `JobRejected`, `/settle` returns 402, and the signed authorisation
  in Bob's hands is simply never submitted. **No money moves on a rejected job** — not by policy,
  by control flow.
- **Bob triggers settlement, not Alice.** The incentive is his. Alice's obligation ended when she
  signed; she does not have to be online for Bob to get paid.

### Where the code is

| Concern | File |
|---|---|
| x402 `exact` scheme: quote / authorize / verify / settle | `packages/payment/src/hedera-x402.ts` |
| The rail-agnostic interface both backends implement | `packages/payment/src/index.ts` (`PaymentBackend`) |
| The "no `JobVerified`, no settlement" guard | `packages/payment/src/guard.ts` |
| Delegated signing — the key's only home | `packages/payment/src/signer/hedera-signer.ts` |
| HCS timeline writer + mirror-node reader | `packages/payment/src/hcs-timeline.ts` |
| The timeline's schema and leak check | `packages/shared/src/timeline.ts` |
| The 402 gate on Bob's public server | `packages/bob-agent/src/index.ts` |
| The end-to-end orchestration | `packages/demo/src/index.ts` |
| The dApp's timeline panel (reads the mirror node live) | `web/src/lib/server/mirror.ts` |

### SDKs actually imported

- `@x402/core` — the resource-server and facilitator client machinery.
- `@x402/hedera` — the `exact` scheme for Hedera, client and server halves, plus
  `createClientHederaSigner`.
- `@hiero-ledger/sdk` — `TopicMessageSubmitTransaction` and `Client` for the HCS timeline.
- The Hedera **mirror node** REST API for every read (`testnet.mirrornode.hedera.com`).

No Solidity on the Hedera side. HCS and HBAR transfers are native services; there is no contract,
no deploy and no ABI in this half of the system.

---

## 3. The HCS timeline — the part that is ours, not the reference example's

The reference x402-Hedera example settles a payment. It does not attest anything. We attest the
**whole job**, and the topic is the only place where the payment, the compute and the verdict
appear in one ordered record:

| Stage | Written when | Carries |
|---|---|---|
| `402_ISSUED` | Bob quotes | price, currency, rail |
| `INTENT_COMMIT` | Alice signs the EIP-712 intent | client address, agent id, deadline |
| `ENCLAVE_INVOKED` | the work starts | agent id, `imageHash`, `attestation` |
| `OUTPUT_COMMIT` | the work returns | output hash, `match` |
| `SETTLED` | the transfer lands | rail, Hedera tx id, the `JobVerified` tx hash |

Four properties, each enforced in code and checked by `pnpm gate:P4-D`:

1. **Consensus order, not our order.** `record()` appends to a promise chain so submissions stay
   sequential; the sequence numbers and `consensus_timestamp`s in the fixture are Hedera's, read
   back from the mirror node. We never display our own clock and call it consensus.
2. **Commitments only.** `assertNoPlaintext` scans every event against the brief, the data and the
   output *before* submission. A leak never reaches the network rather than being caught after.
   What is hidden is *what* the job was; what is deliberately not hidden is *that* it happened.
3. **The rejection is recorded too.** On a fraud run the topic shows
   `402_ISSUED → INTENT_COMMIT → ENCLAVE_INVOKED → OUTPUT_COMMIT(match:false)` and then stops.
   The absence of `SETTLED` is itself the evidence, and it is tamper-evident because it lives on
   a public topic. See `fixtures/hedera/P4-D.json` → `fraudTimeline`.
4. **It is written on every run, on both rails.** The timeline is not a Hedera-run feature; it is
   the project's audit layer. A run paid on Base still writes its lifecycle to Hedera.

Non-blocking by design: `record()` queues and returns immediately, `flush()` waits at the end, so
five ~2 s submissions never sit on the demo's critical path.

---

## 4. Delegated signing — the key never enters agent context

The track is about agents that move value autonomously, which raises the obvious question: what
exactly is the LLM holding? Nothing.

`packages/payment/src/signer/hedera-signer.ts` is the only module that reads
`HEDERA_OPERATOR_KEY`. The key is read *by that module* from the environment — there is
deliberately no parameter through which a caller could pass one in — and it stays in a closure.
The handle that leaves exposes `accountId`, `network` and the ability to sign, and overrides
`toJSON`, `toString` and Node's inspect symbol to return `[REDACTED]`, so an accidental log line
or a serialised error object cannot leak it.

Two supporting facts:

- `loadConfig()` (`packages/shared/src/config.ts`) validates `HEDERA_OPERATOR_KEY` but
  **transforms its value away** before returning. Config-shaped access is closed too.
- `pnpm gate:P4-C` asserts at runtime that the key appears in neither the agent process's log
  output nor an `inspect()` dump of its objects.

This is Hedera's own canonical pattern —
`Client.setOperatorWith(accountId, publicKey, transactionSigner)` exists so the key can live in a
KMS/HSM while the SDK only calls a signing function. Here the vault is a local closure. The
boundary is in the same place; swapping the inside of `createHederaSigner` for a KMS call would
change no caller.

Separately, the *reasoning* layer (`packages/shared/src/reasoning*.ts`) spawns with a scrubbed
environment: the brain that decides who to hire and what to pay is never handed a secret at all.
"It was never given it" beats "it could not have used it".

---

## 5. Reproducing it

```bash
pnpm install
cp .env.example .env          # fill in: HEDERA_OPERATOR_ID/KEY, BOB_HEDERA_ACCOUNT,
                              # HEDERA_TOPIC_ID, BLOCKY402_URL, BLOCKY402_FEE_PAYER
pnpm build

pnpm gate:P0-E                # 402 → pay → 200 against the live facilitator
pnpm gate:P4-A                # the rail-agnostic PaymentBackend contract
pnpm gate:P4-C                # full job paid on Hedera + the delegated-signing proof
pnpm gate:P4-D                # the five-stage HCS timeline, honest run and fraud run
```

A full job on the Hedera rail, end to end:

```bash
PAYMENT_BACKEND=hedera pnpm demo:base
PAYMENT_BACKEND=hedera pnpm demo:base -- --fraud substitute   # rejected: no SETTLED, no money
```

Or run the dApp (`pnpm --filter @ca/web dev`) and pick the Hedera rail in the dashboard — the
timeline panel reads the topic back from the public mirror node and shows the query URL it used,
so the same read can be re-run without us.

Faucet: [portal.hedera.com](https://portal.hedera.com) (100 HBAR / 24h). A job costs 0.01 HBAR
plus about 0.0002 HBAR per timeline message.

---

## 6. Against the track's requirements

**Required**

| Requirement | Status |
|---|---|
| An AI agent / multi-agent system executing a payment on Hedera testnet | ✅ Two autonomous agents, real HBAR transfer, HashScan record above |
| Uses Agent Kit, ACP, x402, A2A, or the Hedera SDKs | ✅ x402 (`@x402/hedera`) + `@hiero-ledger/sdk` + mirror node |
| Public repo with a README covering setup, architecture and the payment flow | ✅ the root `README.md` and this document |
| ≤ 5-minute demo video of the agent paying autonomously | ⏳ see the root README's status table |

**Optional — what we did**

- **x402 pay-per-request access.** Bob's `/task` is a paid endpoint: 402 without an
  authorisation, no work done, and the authorisation must name Bob as payee.
- **Verifiable payment audit trail on HCS.** Five stages, consensus-ordered, commitments only,
  and the rejection path is on the topic too.
- **On-chain agent identity.** ERC-8004 on Base Sepolia, indexed by our subgraph and used for
  discovery. Hedera-native identity (HCS-14) is *not* done — see below.
- **Multi-agent negotiation and settlement.** Bob quotes, Alice's brain approves or refuses under
  a hard ceiling, Bob triggers settlement. It is genuine agent-to-agent negotiation, but over our
  own ECIES/HTTP transport — **not** A2A or OpenClaw ACP.

---

## 7. What we did NOT build, and how we would

Written so a judge does not have to guess, and so whoever picks this up next has a starting point.
Ordered by value per hour of work.

### 7.1 HCS-14 UAID bridge (planned as P4-E, not implemented)

**What is missing:** the agents' identity is ERC-8004 on Base Sepolia only. There is no
Hedera-native handle for them.

**How:** `@hashgraphonline/standards-sdk` is already a dependency. Derive a UAID from the existing
ERC-8004 identity (registry address + chain id + `agentId`) rather than minting a second one —
this must be a *bridge*, not a second registry, and the README has to say so. Publish the UAID in
the agent card (`packages/shared/src/schema.ts`) and resolve it back to the `agentId` in
`packages/shared/src/identity.ts`. Done when the resolution works in both directions.
**Estimate:** 1–2 h. **Best value of anything on this list.**

### 7.2 The asset label is wrong on the Hedera rail

**What is broken:** `packages/demo/src/index.ts` hard-codes the job price as
`{ amount: '1000000', asset: 'USDC', decimals: 6 }` regardless of rail. On the Hedera run the 402
body therefore advertises "1 USDC" while the chain settles 1,000,000 tinybar of HBAR. The transfer
is real and correct; the label above it is not. It is visible in `fixtures/hedera/P4-C.json`, where
`paymentGate.asset` and the settled `transfers` disagree.

**How:** make the price rail-derived — `{ asset: 'HBAR', decimals: 8 }` when
`PAYMENT_BACKEND=hedera`, USDC/6 on Base — and assert the agreement in `gate:P4-C`.
**Estimate:** ~20 min. Fix this before the video.

### 7.3 `intentHash` is not bound into the payment itself

**What is missing:** the Hedera `exact` scheme has no memo or extra field, so the payment and the
job it pays for are correlated through the HCS timeline, not bound cryptographically. The module
says so in its own header comment; we are not claiming more than that. (The Base rail is different
— the intent is bound there.)

**How, in increasing order of honesty:** (a) carry the `intentHash` in the memo of a native
`TransferTransaction` and drop x402's `exact` scheme for a hand-rolled flow — cheap, but loses the
facilitator; (b) settle through a `ScheduleCreateTransaction` whose memo carries the hash (see
7.4); (c) propose an `extra` field upstream in the scheme. We would take (b).

### 7.4 Hedera Scheduled Transactions

**What is missing:** the pending authorisation lives in Bob's process memory between the 402 and
the settlement. If Bob dies, the authorisation dies with him.

**How:** replace the in-memory hold with a `ScheduleCreateTransaction` for the transfer, created
at authorisation time with the `intentHash` in the schedule memo, and signed by the second party
once `JobVerified` appears on Base. The escrow then lives on Hedera instead of in a Node process,
the memo solves 7.3, and it earns the track's "scheduled or recurring payments" line. This is the
architecturally right version of what we built. **Estimate:** 3–4 h, and it touches the settle
path, so not something to attempt the night before a demo.

### 7.5 HTS instead of raw HBAR

**What is missing:** payment is HBAR only. No token creation, no custom fees, no royalties.

**How:** create a job-credit token with `TokenCreateTransaction`, associate Bob, and pass its
token id as the x402 asset instead of `0.0.0` (`HBAR_ASSET_ID` in `hedera-x402.ts`) — the `exact`
scheme takes an asset id, so this is mostly configuration plus an association step. A fractional
custom fee on that token would give the "marketplace takes a cut" story a real on-chain
implementation instead of a slide. **Estimate:** 2–3 h.

### 7.6 Hedera Agent Kit

**Status:** `@hashgraph/hedera-agent-kit` is in `package.json` and its MCP server is in
`.mcp.json`, but **no code imports it**. We wrote the HCS layer directly against
`@hiero-ledger/sdk` because the enclave package must not carry a heavy dependency, and the payment
layer against `@x402/hedera`. Nobody should read the dependency list and conclude otherwise.

**How, if wanted:** swap `hcs-timeline.ts`'s writer for `HcsAuditTrailHook` from
`@hashgraph/hedera-agent-kit/hooks`, or expose Bob's operations as Agent Kit tools so a LangChain
agent could drive him. Neither adds a capability we lack; it would be for ecosystem alignment.

### 7.7 A2A / OpenClaw ACP, and UCP discovery

**What is missing:** negotiation runs over our own ECIES-encrypted HTTP, and discovery runs
through The Graph over ERC-8004. Neither speaks A2A, ACP or UCP.

**How:** the negotiation is already factored as quote → approve → authorize → settle, so an ACP
adapter would be a transport wrapper over `PaymentBackend` plus an agent-card translation rather
than a redesign. It is a real day of work, though, and it buys protocol compatibility, not new
behaviour.

### 7.8 Smaller ones

- **Hedera CLI (`hcli`)** — mentioned in our plan, never used. Automating topic creation and
  account funding through it would tick the track's CLI line.
- **Real-time mirror subscription** — reads currently poll the REST API
  (`readTimeline` retries on an interval). `TopicMessageQuery` would give a live-streaming
  timeline panel instead of a polled one.
- **Micropayment streaming** — out of scope for us entirely. Our unit of payment is a job, not a
  token of inference.

---

## 8. Honest boundaries specific to Hedera

- **The Hedera run buys autonomy, not privacy.** Payer and payee are plain account ids, visible on
  HashScan. Recipient unlinkability is the Base rail's job (ERC-5564 stealth addresses), and we do
  not claim it here. The module says this in its own header.
- **The verdict is not on Hedera.** `JobVerified` is emitted by a contract on Base Sepolia.
  Hedera holds the payment and the timeline. We chose one source of truth per layer on purpose and
  did not duplicate the verdict to make a track look bigger.
- **The timeline is a transparency layer, not a privacy layer.** It hides *what* the job was. It
  is meant to reveal *that* it happened.
- **The brain is not attested.** The LLM that picks the counterparty and approves the price is
  unverified and outside every cryptographic guarantee we make. It can refuse to trade; it cannot
  overpay past the ceiling, invent a counterparty, or make an invalid job settle. If the brain and
  the contract disagree, the contract is the one that decided.
