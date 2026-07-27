# Finalist script — 4 minutes on stage, 3 minutes of questions

For the ETHGlobal finalist slot. The deck is `docs/deck/index.html`; press **N** for the notes
drawer, arrows to advance. This file is the *spoken* version — shorter than the notes in the deck,
because the notes were written for a five-minute cut and you have four.

**Slides used:** 1 · 2 · 4 · 5 · 8 · 9. Slides 3, 6, 7 and 10 are skipped — set the deck to the
keep-cut and skip past them, or hide them before you go up. Slide 10's closing sentence is folded
into the last ten seconds.

**Delivered at 150 words a minute this runs about 4:15.** The lines marked `[CUT IF BEHIND]` take
it to 3:55. Decide which ones you are dropping *before* you walk up, not on stage.

---

## Before you are called

- Deck open, **full screen, slide 1**, notes drawer closed.
- The fraud-run recording open in a second window, **paused on the first frame**, volume off.
  → **This does not exist yet.** See "The one thing to do before the finals" at the bottom.
- Laptop on mains power, display sleep off, notifications off.
- Phone hotspot on and already joined, in case the venue wifi is the thing that fails.

---

## 0:00 — Slide 1 · Here is everything the chain saw *(30s)*

> "This is one job, twice.
>
> On the left, what actually happened — a client agent hired an analyst agent, sent it a
> confidential brief and a data file, got a six-page analysis back, and paid for it.
>
> On the right is every byte a chain observer got. Two hashes.
>
> And yet a contract on Base publicly confirmed that the work delivered was provably *the work
> that was ordered*. Both of those things are true at the same time. Nobody had that combination."

*Do not read the panels. Let them read while you talk.*

---

## 0:30 — Slide 2 · Three solved problems, one missing wire *(35s)*

> "It's not because a piece was missing. Payment is solved — x402. Private execution is solved —
> TEEs. Reputation is solved — ERC-8004. Three good pieces, and no wire between them.
>
> A TEE signature says *a computation happened in here*. It says nothing about **which computation
> you ordered**. So I pay for a market analysis, the agent runs something cheaper, signs the
> output — and the signature still verifies. The attestation is real. The job is wrong.
>
> `[CUT IF BEHIND]` And that only starts biting when no human opens the PDF — which is the entire
> premise of agent commerce."

---

## 1:05 — Slide 4 · One signed hash, carried all the way through *(45s)*

> "The wire turned out to be one number.
>
> Alice hashes everything that defines her job — brief, data, constraints, price, nonce — and
> signs it, EIP-712. That hash is now the identity of the job.
>
> It authorizes the payment. It goes into the enclave at the top of the prompt, and the model
> copies it verbatim — so it comes back out *inside* the response body that 0G's TEE signs. Bob
> cannot manufacture that on his own machine; the first link comes from 0G silicon.
>
> `[CUT IF BEHIND]` And it is the value the contract recovers before it will emit a verdict.
>
> So the guarantee isn't 'a TEE produced an output.' It's '*this* TEE produced *this* output for
> *this* order.' We call it intent-bound verification. **0G attests the compute. We attest the
> intent.**"

*The last two words are the thesis. Land them, then pause one beat before moving.*

---

## 1:50 — Slide 5 · One job, four networks, zero overlap *(35s)*

> "Four networks, one job, and none of them duplicates another.
>
> **Base is the verdict** — the contract recovers two signatures and emits `JobVerified`.
> **Hedera is the money and the timeline** — x402 through the blocky402 facilitator, and every
> stage committed to a Consensus Service topic as a hash, never as content.
> **The Graph is the read layer** — Alice is never given Bob's address; she queries by skill and
> ranks by deliveries a *contract* confirmed.
> **And 0G is the compute and the archive.**
>
> Drop any one of them and something stops being checkable."

*This slide is the answer to "why four chains" — if a judge was going to ask it, you just took it
off the table. Every id on the slide is live.*

---

## 2:25 — Slide 8 · We shipped the attack, not just the defence *(55s)*

**The money shot. If you are running long, steal the time from anywhere except here.**

> "Here's the part I'd want to see if I were judging.
>
> There's a switch in our demo that makes Bob dishonest. He answers a *different* job than the one
> Alice ordered — and he delivers it with a perfectly valid TEE signature. Under any 'attested
> compute' system, that passes."

**→ Play the recording here. Say nothing for the first five seconds.** When the verdict lands:

> "Under ours, the hashes don't match — and the contract rejects him live on Base Sepolia.
> `MatchFalse`.
>
> The rejection is written to the Hedera topic, so the attempt is permanent and public. And the
> settlement guard re-reads the `JobVerified` receipt before releasing anything, so the signed
> payment authorisation is simply never submitted. **He did the work and gets nothing.**
>
> `[CUT IF BEHIND]` Four attacks sit behind that one switch — substitute the job, tamper the
> input, forge the body, supply his own intent. All four get rejected."

---

## 3:20 — Slide 9 · What we didn't fake *(30s)*

> "One gap, and we're naming it ourselves rather than making you find it.
>
> The code that decides whether the hashes match runs on an ordinary host. We had no TDX machine
> and 0G doesn't host enclave execution for us. We could have shipped a screenshot of an
> attestation and most people would never check — instead, `attestation: 'none'` and
> `imageHash: null` are in the code *and* in the UI.
>
> What you get: Alice can verify the match herself. What you don't: a stranger can't, yet. That's
> **one machine away**, and nothing else in the pipeline moves."

*Say this at normal speed, not apologetically. It is a strength — thirty-nine of forty teams will
be overclaiming, and the judges know it.*

---

## 3:50 — Close *(10s)*

> "We built the primitive, not a marketplace. Everything you just saw is live on four testnets,
> every hash on those slides opens on a public explorer, and I'd love to go deeper in questions."

*Stop. Do not add a thank-you paragraph. Silence is a strong ending.*

---

# The 3 minutes of questions

Answer in **two sentences, then stop.** The most common way to lose a Q&A is to keep talking past
the answer and walk into a claim you can't support.

### "Did you build the TEE?"
No — 0G did. We bind it to the client's intent. We verify signatures on chain and check the
attestation off chain at setup; it is not a raw on-chain TDX quote, and we say so.

### "Is the match check verifiable by me, or do I have to trust you?"
Today: by the client, not by a stranger — the recompute runs in unattested code because we had no
TDX host. With an attested runtime the attestation would read `codeDigest + inputHash +
outputHash` and nobody would need to trust us. That's one deployment, not a redesign — the binding
is already a pure function with no environment reads in it.

### "The model output isn't deterministic — how can you recompute it?"
We don't. We recompute the **intent hash** from the brief and the data, which is deterministic, and
we bind the output by *its* hash. Nothing in the system ever tries to reproduce a model's answer.

### "What if the model doesn't copy the hash?"
Then `intentEchoed` is false and the dashboard shows it — we surface the failure, we don't hide it.
Measured 5 out of 5 verbatim (`scripts/og-probe-echo.ts`, gated in `pnpm gate:P3-B`), and the check
is exact match on all 64 hex characters, run by our binding code against the raw output — *not* by
the compute backend, which could otherwise claim it inserted the commitment itself.

### "What stops an agent from farming its own reputation?"
Nothing stops it; it costs. You can't write the score, only earn it, and earning it means a job the
contract verified — a real inference and real gas per fake delivery. A ring of agents you control
can still hire each other, because cryptography can't tell a fake *relationship* from a real one.
What we do is make it paid and visible: every job's client, timestamp and price is in the same
public index, so the ring is queryable. The right fix is weighting a delivery by the client's own
standing — computable from data we already index. We haven't built it.

### "Why four chains? Isn't that for the prize money?"
Because none of them duplicates another: Base is the verdict, Hedera is the money and the timeline,
The Graph is the read layer, 0G is the compute. Drop one and something stops being checkable. Ask
me which one you'd remove and I'll tell you what breaks.

### "Why a TEE and not a ZK proof?"
Because a zero-knowledge proof of a 7-billion-parameter inference isn't practical today, and this
had to actually run. The binding is orthogonal to the attestation primitive — swap the TEE for a
proof when they're ready and the intent hash doesn't change.

### "How slow is it?"
p50 21.0 seconds, p95 22.7, over 5 runs against a 60-second budget — `fixtures/latency/P0-G.json`,
reproduce with `pnpm measure:e2e`. The 0G inference call is ~12.4s of that; it's the dominant term.

### "An LLM makes the decisions — isn't that the weak link?"
It's a separate axis and we label it separately: `computeProvider` says who produced the
deliverable, `reasoningProvider` says who chose. The brain is unattested and outside every
guarantee we make — but it's boxed by three walls in code, not in a prompt: it never sees a private
key, it must name a candidate that was actually offered, and its price approval is ANDed with a
hard ceiling. It can refuse to trade. It cannot overpay, invent a counterparty, or make an invalid
job verify.

### "What's the business model?"
We deliberately didn't build a marketplace — the primitive is the contribution. The general form is
that any x402 endpoint can be intent-bound, and the intent hash becomes a portable receipt:
reputation anchored to work that was verified, not merely paid for.

---

## Sentences that must not come out of your mouth

- "solves prompt injection" — it catches task substitution and input tampering, nothing else
- "Sybil-proof" — expensive and visible, not impossible
- "first confidential agent payments" — ProwlFi and TACEO shipped before us
- "private on Hedera" — that run buys autonomy; the privacy is on the Base run
- "two TEEs" — one, 0G's
- "the 0G signature covers the answer" — it covers the answer's **fingerprint**
- "decentralized compute" — the provider we pinned reports `ProviderType: centralized`,
  `ProviderIdentity: aliyun`. The seal is real; the operator is one cloud.

If you catch yourself starting one of these, the honest version is shorter anyway.

---

## The one thing to do before the finals

**Record the fraud run.** The README still says demo videos are not recorded, and slide 8 is built
around playing one. Four live testnets on venue wifi with a four-minute clock is not a risk worth
taking — `README.md` itself warns that the first 0G call pays an expensive broker setup and that
the subgraph can return 429.

Record it at `OG_STORAGE=0`, both runs (honest then fraud), trim to the two verdict moments, and
play it at 1.5×. Twenty seconds of screen capture is the whole ask.
