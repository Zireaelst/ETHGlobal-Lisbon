# Intro script — project first, problem second

The deck opens with the demo, because at a sponsor table you have to earn the right to explain
yourself. This script is the other order: **say what it is, then say what was broken.** Use it when
someone asks "so what did you build?" away from a screen — a judge in a corridor, a mentor, a
sponsor rep who walked up mid-conversation, the first minute of a conversation you didn't plan.

About 90 seconds spoken. Everything here is claim-safe — see the boundaries in `CLAUDE.md` §11.

---

## Part 1 — What it is *(~30s)*

> "We built a system where two AI agents who have never met can hire each other, pay each other,
> and prove the work was done right — without either of them, or anyone watching the chain, seeing
> what the work actually was.
>
> One agent is a client. It needs an analysis done. The other is a specialist. They find each other
> through a public registry, the client sends an encrypted brief, the specialist runs the model
> inside a sealed enclave, and the work comes back encrypted.
>
> At the end, a smart contract publicly confirms the job was delivered correctly. The chain sees
> two hashes and nothing else. It never sees the brief, the data, or the answer.
>
> We call the idea **intent-bound verification**."

*If they look interested, stop here and let them ask. If they nod politely, keep going — the next
part is the one that changes their face.*

---

## Part 2 — The problem *(~40s)*

> "Here's the thing that was missing, and it's easier with an example.
>
> Imagine you pay a translator to translate a forty-page contract. A file comes back with a
> notary's seal on it. The seal is real — it says *'this document was produced in my office.'* But
> the notary never looked at what was translated. So if he translates some other document he
> already had lying around and seals that, **the seal still checks out.**
>
> That is exactly where AI agents are today. A TEE signature says *a computation happened in here.*
> It says nothing about **which computation you ordered.** Run something cheaper, sign the output,
> and it still verifies. The attestation is real. The job is wrong.
>
> Right now that doesn't hurt, because at the end of the chain a human opens the file and notices.
> That human was the entire quality-control layer.
>
> And the whole premise of agent commerce is that **nobody opens the file.** The moment you remove
> that reader, delivering the wrong work becomes free money. You don't even need bad intent — the
> cheap job pays better and nobody is looking."

---

## Part 3 — What we did about it, and what it's worth *(~25s)*

> "So we took the client's order — the brief, the data, the constraints, the price — hashed it into
> one number, and had her sign it. That number is now the identity of the job.
>
> Then we carry it through every stop. It authorizes the payment. It goes into the enclave inside
> the prompt and comes back out inside the response that 0G's hardware signs. And the contract
> checks it before it will emit a verdict.
>
> So the guarantee isn't 'a TEE produced an output.' It's **'this TEE produced this output, for
> this order.'**
>
> What that's worth: the buyer's money doesn't move until the work is proven to be the work she
> ordered — in our demo the seller cheats, the contract rejects him, and he did the work for
> nothing. And the seller gets a reputation he can't buy, only earn, because the only thing that
> increments it is a contract saying a job checked out.
>
> All of that without the chain ever seeing the work. You don't have to pick between provable and
> private any more."

---

## The 20-second version

For when you have one breath, not ninety seconds.

> "You pay an agent, a signed output comes back, the signature verifies — but nothing tells you
> that output answers *your* question. Today a human catches that. In an agent economy there is no
> human. So we carry the client's signed order hash from the payment, through the enclave, onto the
> chain — and the contract verifies not 'work happened' but '**the work that was ordered** happened.'
> And it does that without ever seeing the work."

---

## If they ask one follow-up, it will be one of these

**"Isn't that just a TEE?"**
The TEE is 0G's and we didn't build it. What's ours is the binding: the client's signed commitment
goes into the prompt, the model copies it verbatim, so 0G's hardware ends up signing a body that
*contains* the order. The seller can't manufacture that on his own machine.

**"Who checks the check?"**
Today the client can, independently, from the response. A stranger can't yet — the code that
compares the hashes runs on an ordinary host, because we had no attested machine this weekend.
That's one deployment away and we'd rather tell you than have you find it.

**"Why would anyone need this?"**
Every agent marketplace being built right now assumes agents will buy work from each other without
a human reviewing it. That assumption is the product — and it has no fraud check underneath it.

---

## Never in this conversation

Don't say "solves prompt injection" (it catches task substitution and input tampering), "Sybil-proof"
(expensive and visible, not impossible), "we built the TEE" (0G did), or "the 0G signature covers
the answer" (it covers the answer's fingerprint). The full list is in `docs/table-pitch.md`.
