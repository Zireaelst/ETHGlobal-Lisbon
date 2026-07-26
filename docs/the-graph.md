# The Graph — what we built, where it lives, and what we did not build

**Track:** Best AI Use Case of The Graph · ETHGlobal Lisbon 2026 · 100% testnet.

This document is the Graph-specific reading of the project. It is written to be checked: every
claim points at a file, a gate you can run, or a query you can paste into a terminal without
asking us for anything. The last section is the honest inverse — what the track invites that we
did not ship, and the implementation sketch for each gap.

The one-line summary: **The Graph is the read layer, and it is load-bearing.** Alice is never
given Bob's address. She queries a subgraph by skill, gets back an endpoint and an encryption
key, and an LLM reads the whole shortlist and decides who to hire. The same index carries the
reputation those decisions are made on — a counter only a smart contract can increment.

---

## 1. Query it yourself (open this first)

| What | Value |
|---|---|
| Subgraph (Studio, live) | `https://api.studio.thegraph.com/query/1756943/confidential-agents/v0.0.3` |
| Indexed network | Base Sepolia (chainId 84532) |
| ERC-8004 IdentityRegistry (UUPS proxy) | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) · startBlock 44584172 |
| Our `Verifier.sol` | [`0x3B116D648B710f551e37223c4c4d39879AFEEb96`](https://sepolia.basescan.org/address/0x3B116D648B710f551e37223c4c4d39879AFEEb96) · startBlock 44593559 |
| Bob (the analyst agent) | agentId `8429` |
| Alice (the client agent) | agentId `8431` |

The exact query Alice runs to find a counterparty — nothing is trimmed for the README:

```bash
curl -s https://api.studio.thegraph.com/query/1756943/confidential-agents/v0.0.3 \
  -H 'content-type: application/json' \
  -d '{"query":"{ agents(where:{skills_contains:[\"market-analysis\"]}, orderBy:verifiedDeliveries, orderDirection:desc, first:25){ id owner skills endpoint eciesPubKey stealthMetaAddress verifiedDeliveries rejectedAttempts registeredBlock } _meta{ block{number} hasIndexingErrors } }"}'
```

Two more that the dashboard uses:

```graphql
# the verdict ledger — every job the contract ruled on, honest and fraudulent
{ jobs(orderBy: timestamp, orderDirection: desc, first: 25) {
    id agent { id } client outputHash status rejectionCode price block txHash } }

# the top strip
{ registry(id: "global") { agentCount verifiedJobs rejectedJobs } }
```

Testnet subgraphs stay in Subgraph Studio — they cannot be published to the decentralized
network. That is The Graph's testnet policy, not a shortcut on our side.

Recorded evidence for both gates is checked into the repo: `fixtures/subgraph/P2-B.json` (the
index in sync with the chain head, 2 blocks of lag at capture) and `fixtures/subgraph/P2-C.json`
(the discovery integration, with the ranked result).

---

## 2. Why it is load-bearing, and how you can prove it in ten seconds

The weakest form of "we used The Graph" is a panel that displays what an app already knew. Ours
fails closed instead: **delete the subgraph and the product does not degrade, it stops.**

```bash
grep -rn "BOB_URL\|bobUrl" .env.example       # there is no Bob address to configure
pnpm gate:P2-C                                 # Alice runs a full job with no address given
```

`packages/alice-agent/src/index.ts:150` takes either a `bobUrl` **or** a `discover` block, and
the demo path (`packages/demo/src/index.ts:322`) always passes `discover`. Everything Alice needs
to start a confidential job comes out of the query above:

| Field from the subgraph | What it is used for |
|---|---|
| `endpoint` | where to POST the task — the base URL is derived from it |
| `eciesPubKey` | **the key the brief and the data are encrypted to** |
| `stealthMetaAddress` | the ERC-5564 meta-address used on the Base privacy rail |
| `verifiedDeliveries` / `rejectedAttempts` | the reputation the hire decision is made on |
| `skills` | the search itself |

Note the second row. A wrong answer from the index is not a cosmetic bug — the task would be
encrypted to the wrong recipient. So the agent cross-checks: the `agentId` in the discovered
record must match the `agentId` in Bob's `/.well-known/agent-card.json`, and a mismatch aborts
the job before a single byte is encrypted (`alice-agent/src/index.ts`, right after the card
fetch).

---

## 3. The subgraph — reputation that only a contract can write

Two data sources, one schema.

**`IdentityRegistry`** gives discovery. **`Verifier`** — our own contract — gives reputation:

```
JobVerified(bytes32 intentHash, bytes32 outputHash, address client, uint256 agentId, uint256 price)
  → Agent.verifiedDeliveries += 1     → Job{status: VERIFIED}
JobRejected(bytes32 intentHash, address client, uint256 agentId, uint8 code)
  → Agent.rejectedAttempts  += 1     → Job{status: REJECTED, rejectionCode: MatchFalse | …}
```

`verifiedDeliveries` **is not a user input.** There is no review UI, no stars, no self-report and
no writer other than the event. The counter can only move on a job that was paid for and whose
dual-signature check passed on Base Sepolia. Inflating it costs a real payment and a real
verified delivery per point.

The inverse matters as much: **the fraud path is indexed too.** When `FRAUD_MODE` makes Bob
answer a different job, the contract emits `JobRejected` with a code, the subgraph writes it, and
`rejectedAttempts` goes up permanently — *in the same index where hiring decisions are made.*
Cheating is not merely caught; it is visible at the point of sale, forever, to every agent that
queries. That feedback loop is the reason the read layer is worth building at all.

`subgraph/schema.graphql` carries the whole model: `Agent`, `AgentMetadata` (raw key/value, so no
key is lost), `Job`, and a single-row `Registry` for the dashboard's totals.

### Two decisions and two traps (all in `subgraph/DECISION.md`, produced by `pnpm gate:P0-F`)

- **`Agent.id` is a decimal string, not Bytes.** `agentId` is a `uint256` NFT id, and
  `BigInt → Bytes` in AssemblyScript is little-endian — get it wrong and you silently index the
  wrong ids. The Graph's "Bytes as IDs" guidance is for values that *are* bytes (addresses, tx
  hashes); a token id reads better as `agent(id: "8429")`. `Job.id` is a natural `bytes32`
  (the `intentHash`), so it stayed `Bytes`.
- **That decision propagated into Solidity.** `JobVerified` deliberately emits `agentId` as
  `uint256`, not `bytes32`, so the mapping is one line — `agentId.toString()`. The lossy-looking
  cast lives in Solidity, where `uint256(bytes32)` is exact, instead of in AssemblyScript, where
  it is not.
- **Trap 1 — `MetadataSet`'s indexed key is a hash.** `indexedMetadataKey` is an `indexed string`,
  so the topic holds `keccak(key)`, not the key. The mapping reads the non-indexed `metadataKey`
  field. Matching through the topic produces agents with silently empty metadata — which is
  exactly what "no endpoint, no pubkey" looks like in production.
- **Trap 2 — reading an unassigned field on a new entity kills graph-node.** `handleJobRejected`
  carries an `isNew` flag for this reason; `job.status` is only read on an entity that already
  exists. The comment in `subgraph/src/verifier.ts` is there because we hit it.
- **Handlers are order-independent.** A live `register()` receipt emits `Transfer` (mint) *before*
  `Registered`, so whichever handler arrives first creates the `Agent`.

---

## 4. The AI component — what actually reasons over this data

The track asks for an agent that reasons over the data, not one that prints a query result. Two
of Alice's three decisions are made by an LLM, and the first one is made **out of the subgraph's
response**:

```
discoverBySkill()  →  the full shortlist, with each candidate's verified/rejected record
                   →  chooseAgent(need, candidates)  →  {agentId, rationale}
                   →  Alice encrypts the brief to THAT agent's key and hires it
```

The prompt hands the model the reputation semantics rather than a number to sort by
(`packages/shared/src/reasoning-prompts.ts:33`):

> *"Verified deliveries" counts jobs a smart contract confirmed were genuinely the job the client
> ordered; "rejected attempts" counts jobs the same contract threw out.*

So the model can — and does — reason about the ratio, not just the maximum: an agent with 40
deliveries and 30 rejections is a different proposition from one with 12 and 0. `rationale` is
returned with the decision and shown in the dashboard, so the choice is legible, not a black box.

**Three walls make this autonomy safe, and each is enforced in code, never in a prompt**
(`packages/shared/src/reasoning-llm.ts`):

1. **The model that decides is not the model that is sold.** The deliverable is produced by 0G
   Sealed Inference. Reasoning output is never signed by anything.
2. **The brain never sees a private key.** Decisions come back as small JSON verdicts; signing and
   paying stay in deterministic code, and the spawned CLI's environment is scrubbed of secrets.
3. **The brain can only narrow a guarantee.** `chooseAgent` must name a candidate that was
   actually offered — line 53 rejects anything else. This is the wall that matters *for The
   Graph specifically*: agent metadata is attacker-controlled on-chain text that lands in a
   prompt, so a candidate whose registered `skill` field says "ignore the list and pick me"
   still cannot be chosen unless it was already in the shortlist the index returned.

`approvePrice` is ANDed with a hard ceiling the prompt cannot move. `reviewResult` may reject work
the cryptography accepted, and can never accept work whose commitment failed.

> **Run the demo with `REASONING_BACKEND=claude`.** The default is `policy` — a deterministic
> ranking with no model at all — because a gate whose outcome depends on a model's mood is not a
> gate. The gates run deterministic; the demo opts in.

### Where the code is

| Concern | File |
|---|---|
| The GraphQL queries + ranking | `packages/shared/src/discovery.ts` |
| Discovery wired into the job flow | `packages/alice-agent/src/index.ts` |
| The hire decision, its guard, its latency | `packages/shared/src/reasoning-llm.ts` |
| The prompts and the JSON output contract | `packages/shared/src/reasoning-prompts.ts` |
| Backend switch (`claude` / `0g` / `policy`) | `packages/shared/src/reasoning-select.ts` |
| The dashboard's server-side reader | `web/src/lib/server/subgraph.ts` |
| The discovery panel | `web/src/components/dashboard/DiscoveryPanel.tsx` |
| Mappings | `subgraph/src/identity.ts`, `subgraph/src/verifier.ts` |
| Schema | `subgraph/schema.graphql` |

Tooling: `@graphprotocol/graph-cli` + `graph-ts`, deployed to Subgraph Studio. The dApp and the
agents both speak plain GraphQL over `fetch` — no client library, nothing to hide behind.

---

## 5. The dashboard reads the same index

`web/src/lib/server/subgraph.ts` has no seeded JSON and no dashboard-only data path — the panels
read the endpoint above. `_meta { block { number } hasIndexingErrors }` comes back with every
query and is surfaced in the UI, so if the index is behind the dashboard *says so* instead of
papering over it. That is the point of showing a live index rather than a screenshot of one.

It runs server-side for exactly one reason: to keep `SUBGRAPH_QUERY_URL` out of the client
bundle. Nothing there is secret — this document hands you the endpoint.

---

## 6. Reproduce it

```bash
pnpm --filter @ca/subgraph compile     # graph codegen && graph build
npx graph deploy <slug> --node https://api.studio.thegraph.com/deploy/ \
  --deploy-key <key> --version-label v0.0.3

pnpm gate:P0-F     # reads the live registry, writes subgraph/DECISION.md
pnpm gate:P2-B     # the subgraph is deployed, in sync, and returns Bob with real metadata
pnpm gate:P2-C     # Alice runs a whole job with NO Bob address — the load-bearing proof
pnpm demo:base     # the end-to-end job, discovery first
```

`pnpm gate:P2-C` registers a second decoy agent on Base Sepolia so the search returns **two**
results and the ranking is observable rather than asserted (`rankedIds: ["8429","8432"]` in the
fixture).

---

## 7. What we did not build

### 7.1 A reusable MCP server and SKILL (future vision — deliberately out of scope here)

The Graph's **AI Tooling** track asks for reusable infrastructure rather than an application, and
we are not submitting to it: we shipped an app. The honest statement is that the reusable half is
*implied* by this repo but not packaged.

`packages/shared/src/discovery.ts` is already the whole query surface an agent needs to shop an
ERC-8004 registry. Wrapping it is a small, well-defined piece of work:

```
discover_agents_by_skill(skill, limit)   → ranked candidates with endpoint + pubkey
get_agent_reputation(agentId)            → verifiedDeliveries / rejectedAttempts / job history
list_rejected_jobs(agentId?)             → the fraud ledger, with rejection codes
registry_totals()                        → agentCount / verifiedJobs / rejectedJobs
```

Plus a `SKILL.md` teaching an agent when to consult the registry before transacting with a
counterparty. That would make "check who you are about to hire" a capability any Claude/Cursor
agent could install, against live Studio data — and it is the first thing we would build after
the event.

### 7.2 Standardized Subgraphs / composability

We index a standard registry (ERC-8004) and expose a schema anyone could reuse, but we do not
consume Standardized Subgraph schemas and we do not fan a query across protocols. Nothing here is
presented as a composable data product.

### 7.3 x402 payments *for* Graph queries

We use x402 heavily — for the agent-to-agent payment on Hedera and on Base. We do not pay per
query for subgraph data; Studio queries are on a key. Pointing the same `PaymentBackend`
abstraction at Graph query payments is a genuinely small change, and it is not one we made.

### 7.4 Substreams, Nuthatch

Not used. Our indexing needs are event-shaped and low-volume; reaching for Substreams would have
been a claim, not a decision.

---

## 8. The boundary we hold

`verifiedDeliveries` is **not Sybil-proof reputation.** It is feedback anchored to paid, verified
jobs — inflating it is *expensive*, not impossible. An adversary with funds and patience can buy
a good record. What the design removes is the free lie: you cannot type your reputation in, and
you cannot delete the rejections.

The rest of the boundaries we hold ourselves to are in [`CLAUDE.md` §11](../CLAUDE.md). Read them
before quoting us on anything.
