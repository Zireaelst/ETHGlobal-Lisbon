# 3:30 — deck, repo, landing, dashboard

Presenter mode (**F**). Skip 02, 05, 06, 10–14 — they exist for the questions afterwards.

Route: **01 → 03 → 04 → 07 → 08 → 09 → repo → landing → /dashboard**

Short sentences on purpose. The first three slides are setup — say them fast and get to the
architecture, which is what people actually want.

---

### 0:00 · Slide 01 — the name *(12s)*

> "**Mithra.** A confidential agents protocol.
>
> Two agents hire each other privately — and prove on chain that it was the right job."

### 0:12 · Slide 03 — two views *(18s)*

> "One job, twice.
>
> Left: what happened. An agent hired another agent, sent an encrypted brief, got the work back,
> paid for it.
>
> Right: everything the chain saw. Two hashes.
>
> And the contract still confirmed it was the job that was ordered. Both are true at once."

### 0:30 · Slide 04 — the problem *(20s)*

> "A notary's seal says *produced in my office*. Real seal. But he never read the document.
>
> Same with agents. A TEE signature says *a computation happened in here*. It does not say **which
> one you ordered**. Run a cheaper job, sign it, it still verifies.
>
> The attestation is real. The job is wrong. Today a human catches that. Agents don't."

### 0:50 · Slide 07 — the idea *(22s)*

> "One number fixes it.
>
> Alice hashes her whole order — brief, data, constraints, price — and signs it.
>
> That hash authorises the payment. It rides into the enclave at the top of the prompt, and the
> model copies it back word for word — so it comes out inside the body the TEE signs. Measured 5
> out of 5.
>
> Then the contract checks it. Not *'a TEE ran something.'* **'This TEE ran this, for this order.'**"

### 1:12 · Slide 08 — the architecture *(45s)*

*Trace it left to right with a finger. Don't read the labels.*

> "End to end. Alice finds Bob through **The Graph** — she never gets his address. She searches by
> skill, ranks by deliveries a contract confirmed. And these are real agents: a decision layer
> picks who to hire and whether the price is worth it. A refusal ends the job. No money moves.
>
> She sends the encrypted brief and an x402 authorisation — signed, not submitted. The money stays
> hers.
>
> Bob recomputes the hash from what he actually got. That's `match`. The model runs in **0G Sealed
> Inference** — Bob never sees the data either — and the enclave returns a signed body carrying her
> hash.
>
> Both signatures go to **Verifier.sol on Base**. It rebuilds the signed body from the struct
> fields — no JSON parsing, no trusting Bob — and requires match.
>
> Pass: payment settles on **Hedera**. Fail: nothing moves. Either way every stage goes to a Hedera
> topic as a hash, never content — and the verdict feeds straight back into reputation."

### 1:57 · Slide 09 — why four *(15s)*

> "Four chains is usually a smell. So: remove one, name what stops being checkable. Base the
> verdict, 0G the compute, The Graph the read layer, Hedera the timeline. Each one has an answer."

---

### 2:12 · The repo *(25s)*

*Open the README. Scroll to the flow block, then the status table, then open `docs/0g.md`.*

> "It's all written up. This is the same flow in the README, and under it a status table that says
> what shipped and what didn't.
>
> And there's a separate write-up per track — 0G, The Graph, Hedera — each naming the exact file,
> the address, and the gate you can run yourself."

*Have `docs/0g.md` · `the-graph.md` · `hedera.md` already open in tabs. Open the one for whoever is
in front of you.*

### 2:37 · The landing page *(15s)*

*One slow scroll. Don't read it.*

> "The front of it — the five stages of the proof, live addresses at the bottom. And the last
> panel: **one enclave, not two.** We say what we didn't build."

### 2:52 · The dashboard *(30s)*

*Open `/dashboard` — fraud mode already selected, logs cleared.*

> "All testnet, nothing mocked. So — one job, and I make the seller cheat.
>
> Notice *how* he has to cheat. Decryption happens inside the enclave, so Bob can't read the brief.
> He can't tamper with it. All he can do is invent a payload and swap it in. **He answers the wrong
> job without even knowing what was asked.**
>
> Two things to watch: the observer panel stays hashes only, and the payment doesn't move until the
> verdict lands."

**Click. Stop talking.**

---

## Falling behind

Drop **slide 09** first — it's implicit in the diagram and it's a ten-second Q&A answer. Then trim
the repo beat to the sponsor doc alone.

## The sentence you must still say

No slide in this cut carries it. Say it once, in the demo or the first answer:

> "The match check runs in unattested code — no TDX host was available. The client holding the
> response can verify it; a stranger can't yet. That gap is one sentence wide, and with our own
> attested enclave the recompute sits inside the seal. Nothing else changes."

## Two answers to have ready

**"Why does the rejection succeed on Basescan instead of reverting?"** — deliberate. The fraud path
emits `JobRejected` instead of reverting, so the subgraph can index it. A revert would make the most
important moment of the demo invisible to the indexer.

**"Is the reputation just your database?"** — no reputation contract, no review UI, nothing a user
can type. `verifiedDeliveries` moves only on `JobVerified`, `rejectedAttempts` only on
`JobRejected`. And the timeline timestamps come back from Hedera's public mirror node, not our clock.
