 Video scripts — three takes, one spine

Three separate recordings. **Do not send one video to three places**: the limits differ, and each
sponsor wants to see their own thing done deeply, not their logo in a list.

| Track | Limit | Target | Spoken words |
|---|---|---|---|
| 0G | under 3:00 | 2:40 | ~380 |
| The Graph | 2:00–4:00 | 3:00 | ~440 |
| Hedera | under 5:00 | 3:30 | ~500 |

**The order is deliberately different from the table pitch.** At a table you open with the problem,
because the person across from you has already agreed to listen. A video viewer has agreed to
nothing and decides in fifteen seconds, so here the rejection comes first and the problem is
explained after it has been earned.

---

## Before you record

- `OG_STORAGE=0` for the recorded run. The archive adds ~15s of upload to a ~13s run and no one
  watches an upload bar. Show the archive from the recorded run instead.
- **One warm-up run first.** The 0G broker setup is expensive on the first call only, and it is the
  difference between 13 seconds and 40.
- Dashboard at `localhost:3000/dashboard`, fraud mode set to **substitute**, logs cleared.
- Deck open in a second window at `docs/deck/table.html`, correct track selected.
- Browser: hide bookmarks, zoom so the log text is legible at 720p, close notifications.
- Second tab ready: the proof bundle (`/api/proof?mode=none`), already downloaded.
- Record at 1080p. Screen text that is unreadable at 720p is text the judge skips.

**These sentences must be said exactly as written**, here and at the table and in the README. A
judge who catches two versions of the same claim stops trusting both.

> "Payment, execution and reputation are each solved for agents. Nothing connects them."
> "The client can verify the match independently; a stranger cannot."
> "The 0G signature covers the answer's fingerprint, not its text."
> "This rail buys autonomy, not privacy."

---

# Shared opening — all three videos (0:00–0:50)

| Time | Screen | Say |
|---|---|---|
| 0:00 | Dashboard, fraud panel, cursor on the button | "Two AI agents that have never met. One is hiring the other, paying it, and getting work back — and nothing in the middle can read what the work is. I'm going to make the seller cheat." |
| 0:08 | **Click.** Logs start streaming | "He's answering a job the buyer never ordered. Watch what the chain does about it." |
| 0:14 | Logs: discovery, 402, enclave | "The buyer found him through a public registry — she was never given his address. She's authorised payment, but the money is still hers. The model is running inside a 0G enclave right now, and the seller can't read the brief either — the decryption key isn't in his server." |
| 0:32 | Verdict card appears — red | "There it is. `MatchFalse`. The contract on Base recovered both signatures, saw that the commitment didn't match, and rejected the job on chain." |
| 0:42 | Point at the payment line | "And the payment never settled. He did the work and gets nothing." |

---

# 0G · Best AI Product — target 2:40

| Time | Screen | Say |
|---|---|---|
| 0:50 | Deck slide 02 | "Three things are already solved for agents. Payment. Confidential execution. Reputation. Nothing connects them. You can pay an agent and get an answer — but nothing proves it answered *your* question, on *your* data." |
| 1:05 | Deck slide 03 | "So we carry one signed commitment through the whole job. The buyer hashes her brief, her data and the terms into a single intent hash and signs it. The seller's binding code recomputes that hash from what actually arrived and compares. Intent-bound verification." |
| 1:22 | Deck slide 05 (0G) | "0G proves the computation happened. We prove it was the right one." |
| 1:30 | Dashboard, verify panel — `ogVerified`, `intentEchoed` | "The model runs in 0G Sealed Inference, so the party being paid never sees the brief. And here's the part that's ours: the buyer's signed commitment goes into the prompt, and the model copies it back into the answer verbatim. So the signature 0G's hardware produces covers a body that *contains* her intent. The seller can't manufacture that on his own machine — the first link comes from 0G silicon." |
| 1:55 | Evidence panel — provider address, TEE signer | "This is the provider we pinned, TeeML, acknowledged on chain. This is the TEE signer address we recovered from a live signature." |
| 2:05 | The archive row / the proof bundle | "The deliverable is archived on 0G Storage, encrypted. Anyone can fetch it by root hash; only the buyer can read it. And this bundle has the commands to check the signature yourself — nothing of ours in the loop." |
| 2:20 | Deck slide 05, closing line visible | "What we don't claim: we didn't build the TEE, 0G did — we bind it to intent. The 0G signature covers the answer's fingerprint, not its text. And the provider we pinned reports itself as centralized: the seal is real, the operator is one cloud. We say so." |
| 2:35 | Deck slide 06 (close) | "Four networks, none of them duplicating another. All testnet, nothing mocked." |

---

# The Graph · AI Use Case — target 3:00

| Time | Screen | Say |
|---|---|---|
| 0:50 | Deck slide 02 | "Three things are already solved for agents. Payment. Confidential execution. Reputation. Nothing connects them — and the reputation part is where that hurts most, because there's no way to know who to hire." |
| 1:06 | Dashboard, discovery panel | "The buyer was never handed the seller's address. She queried this subgraph by skill and ranked by deliveries a contract confirmed. That's the whole discovery step — no marketplace, no intermediary." |
| 1:22 | Point at verifiedDeliveries / rejectedAttempts | "And you can't write to this reputation. There's no review endpoint. The only thing that moves this counter is a JobVerified event from our Verifier contract. To add one, you have to produce a job the contract accepts — which costs real inference and real gas." |
| 1:42 | Point at the rejected count | "The rejections are indexed on the same record. So the fraud attempt you just watched is now permanently visible, right where hiring decisions get made. That's the part a review platform can't do: cheating and reputation live in the same place." |
| 2:00 | Point at agent count / other agents | "Most of the agents in this index aren't ours. It's a shared public ERC-8004 registry and strangers register into it while we watch — which is how you know this isn't our own sandbox." |
| 2:15 | Query endpoint on screen (or Studio playground) | "Here's the query endpoint. Run it yourself — you'll get the same rows this panel is showing." |
| 2:28 | Deck slide 05 (Graph) | "Two indexing details worth knowing: agent metadata arrives in a separate MetadataSet event, not in Registered — index only registrations and every agent comes back with no skill and no endpoint. And that event's key is an indexed string, so the topic carries its hash, not its value." |
| 2:45 | Closing line | "What we don't claim: this reputation is not Sybil-proof. Faking it costs real work and stays visible in the same index — expensive, not impossible. Weighting a delivery by the client's own standing is the fix, and we haven't built it." |
| 2:58 | Deck slide 06 | "Four networks, none duplicating another. All testnet." |

---

# Hedera · Agentic Payments — target 3:30

| Time | Screen | Say |
|---|---|---|
| 0:50 | Deck slide 02 | "Three things are already solved for agents. Payment. Confidential execution. Reputation. Nothing connects them — so an agent can pay, but it can't tell whether it should have." |
| 1:06 | Deck slide 03 | "We carry one signed commitment through the job, and the payment layer is where that gets teeth." |
| 1:15 | Dashboard, run an **honest** job now | "Same job, run honestly this time." |
| 1:25 | Logs: 402 issued | "The seller answers with a 402. This is x402 on Hedera, through the blocky402 facilitator. The buyer signs an authorisation — and the money is still hers. Nothing has moved." |
| 1:40 | Logs: JobVerified, then settle | "The work happens. The contract on Base verifies it. *Then* the seller submits the authorisation he's been holding — and only then does the money move." |
| 1:55 | HCS timeline panel | "Every stage of that is on a Hedera topic, as a commitment — never content. The brief never touches Hedera. Quote, intent, enclave, output, settled." |
| 2:10 | Show both runs' timelines side by side | "Now compare. The honest run ends in SETTLED. The fraud run you saw at the start stops one stage earlier. That missing stage is the entire argument, recorded on a chain that isn't ours to edit — and you can pull it from the mirror node yourself." |
| 2:32 | Payment panel — paidTo vs agentIdentity | "One more thing, on the Base rail: the payout goes to a fresh stealth address derived per job. It isn't the seller's registered address, and run it twice and it changes. The payment record doesn't name him." |
| 2:50 | Deck slide 05 (Hedera), closing line | "But be clear about which rail does what. The Hedera run buys autonomy and a timestamped trail — it does not buy privacy. The recipient there is the seller's published account, same one every time. The stealth address is on the Base run." |
| 3:05 | — | "And on a testnet with one buyer and one seller, timing still correlates a payout to him. What's hidden is the payment record, not the whole system." |
| 3:18 | Deck slide 06 | "Four networks, none duplicating another. Base is the verdict, Hedera the timeline, The Graph the read layer, 0G the compute. Drop one and something stops being checkable." |

---

## If a run fails on camera

Do not cut and pretend. Say what happened and use the recorded run — the dashboard labels it as a
recording and the labelling is the point. "That's a public RPC rate-limiting us; here's the same run
from twenty minutes ago, and every link on it still opens." A recovered failure reads as competence.
A suspiciously perfect take reads as an edit.

## Never say

- "solves prompt injection" — it catches task substitution and input tampering
- "Sybil-proof" — expensive and visible, not impossible
- "first confidential agent payments" — ProwlFi and TACEO shipped before us
- "private on Hedera" — that run buys autonomy
- "two TEEs" — one, 0G's
- "the 0G signature covers the answer" — it covers the answer's fingerprint
