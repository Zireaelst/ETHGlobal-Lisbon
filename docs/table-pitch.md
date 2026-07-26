# Table pitch — three minutes, one screen

For the sponsor tables, not the finalist video. One shared spine, one section that changes per
track, and the answers to the four questions you will actually be asked.

**The rule this is built on:** the person across the table has seen forty demos today. Opening
with "the problem in agent payments is…" spends your first thirty seconds on a sentence they have
already heard nine times. Open with the thing only you can show, then explain what it was.

---

## Before you sit down

- `/dashboard` open, **fraud mode already selected**, logs cleared.
- `OG_STORAGE=0` for the live click. The archive adds ~15 s of upload to a run that is otherwise
  ~13 s, and nobody watches a progress bar for half a minute. Show the archive from the recorded
  run instead — same evidence, no dead air.
- One warm-up run before the first table of the day. The broker setup is expensive on the first
  call only.
- Second tab: the proof bundle (`/api/proof?mode=none`), already downloaded.
- If the subgraph is rate-limited (429), say so rather than reloading — the discovery panel
  reports the failure honestly and that is the correct behaviour to point at.

---

## The spine

### 0:00 — Hook (20 s)

> "Two AI agents that have never met. One hires the other, pays it, and gets work back — and
> nothing in the middle can see what the work was. I'm going to make the seller cheat."

Click. Do not narrate while it runs.

### 0:20 — The rejection (40 s)

Let the screen do it. When the verdict lands:

> "The seller answered a different job than the one that was ordered. The contract on Base just
> refused it — `MatchFalse` — and the payment never settled. He did the work and gets nothing."

Point at the two lines: the rejection code, and `payment not settled`.

### 1:00 — The problem (30 s)

Now, and only now, the problem — because they have just watched it get solved:

> "Payment, private execution and reputation are each solved for agents. Nothing connects them.
> You can pay an agent and get *an* answer, but nothing proves it is the answer to *your*
> question, with *your* data. We carry one signed commitment from the payment, through the
> enclave, into the reputation index. That's the whole idea: intent-bound verification."

### 1:30 — [ the track section — see below ] (60 s)

### 2:30 — What we do not claim (20 s)

Do not skip this. Thirty-nine of forty teams will be overclaiming.

> "Three things we don't say. We didn't build the TEE — 0G did; we bind it to intent. The match
> check runs in unattested code, because no TDX host was available, so the client can verify it
> independently but a stranger can't — that gap is real and it's the one thing we'd close next.
> And the reputation isn't Sybil-proof; we make faking it cost real work and stay visible, not
> impossible."

### 2:50 — Close (10 s)

> "Everything on that screen is testnet but none of it is mocked — every hash opens on a public
> explorer. The write-up for your track is in the repo, with the exact files and gates."

---

## The track section

### 0G — Best AI Product

> "The model runs in a 0G Sealed Inference enclave, so the party being paid never sees the brief.
> The output comes back signed by the TEE — and here is the part that is ours: the client's signed
> commitment is written into the top of the prompt and the model copies it verbatim into the
> answer. So the signature 0G's hardware produces covers a body that *contains* the client's
> intent. Bob can't manufacture that on his own machine; the first link comes from 0G silicon.
> The deliverable is then archived on 0G Storage, encrypted — anyone can fetch it by root hash,
> only the client can read it."

Show: `ogVerified=true` · `intentEchoed` · the archive root · the pinned provider address.

Say it plainly if asked: the provider we pinned reports `ProviderType: centralized`,
`ProviderIdentity: aliyun`. The TEE seal is real; the operator is one cloud.

### The Graph — AI Use Case

> "Alice is never given Bob's address. She queries the subgraph by skill and ranks by deliveries a
> contract confirmed. And you can't write to this reputation — there is no review endpoint. The
> only thing that increments the counter is a `JobVerified` event from the Verifier. The rejected
> attempts are indexed on the same record, so cheating is permanently visible exactly where the
> hiring decision gets made."

Show: the discovery panel, then the query endpoint — offer to let them POST the query themselves.

The strong detail: of the agents indexed, most are **not ours**. It is a shared public ERC-8004
registry and strangers register into it while we watch. That is the proof it is not our sandbox.

### Hedera — Agentic Payments

> "The payment is x402 through the blocky402 facilitator, and the split matters: Alice authorises,
> but the money stays hers. Bob does the work, and only after the contract emits `JobVerified` does
> he submit the authorisation. Watch what that means on the timeline —"

Show the HCS topic: honest run ends `… → OUTPUT_COMMIT → SETTLED`. Fraud run ends at
`OUTPUT_COMMIT`. The missing stage is the whole argument, recorded on a chain that isn't ours to
edit.

> "Every stage is a commitment, never content — the brief never touches Hedera."

Honest, unprompted: this rail buys autonomy and a timestamped trail, **not** privacy. The stealth
recipient is on the Base run, and we'll show you that one too if you want the contrast.

---

## The four questions you will get

**"Did you build the TEE?"**
No. 0G did. We bind it to the client's intent. We verify signatures on chain and the attestation
off chain at setup — not a raw on-chain TDX quote.

**"Is the match check verifiable by me, or do I have to trust you?"**
Today: by the client, not by a stranger. The recompute runs in unattested code because we had no
TDX host. With an attested runtime the attestation would read codeDigest + inputHash + outputHash
and nobody would need to trust us. That is one deployment away, not a redesign — the binding is
already a pure function with no environment reads in it.

**"What stops an agent from farming its own reputation?"**
Nothing stops it; it costs. You can't write the score, only earn it, and earning it means a job
the contract verified — a real inference and real gas per fake delivery. But a ring of agents you
control can hire each other and every job is genuinely valid, because cryptography can't tell a
fake *relationship* from a real one. What we do is make it paid and visible: every job's client,
timestamp and price is in the same public index, so the ring is queryable. The right fix is
weighting a delivery by the client's own standing — computable from the data we already index.
We haven't built it.

**"Why four chains?"**
Because none of them duplicates another. Base is the verdict, Hedera is the timeline, The Graph
is the read layer, 0G is the compute. Drop one and something stops being checkable.

---

## Sentences that must not come out of your mouth

- "solves prompt injection" — it catches task substitution and input tampering, nothing else
- "Sybil-proof" — expensive and visible, not impossible
- "first confidential agent payments" — ProwlFi and TACEO shipped before us
- "private on Hedera" — that run buys autonomy; the privacy is on the Base run
- "two TEEs" — one, 0G's
- "the 0G signature covers the answer" — it covers the answer's fingerprint

If you catch yourself about to say one, the honest version is shorter anyway.
