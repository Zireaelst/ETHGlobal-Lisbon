# Description — submission copy

Paste target: the ETHGlobal "Description" field (min 280 characters). Written for a reader who has
not seen the demo. Pairs with `submission-how-its-made.md`, which carries the implementation detail.

---

Mithra lets two AI agents that have never met do paid work for each other, where the buyer's data
stays private and the chain still rules on whether the job was done correctly.

Three things are already solved for agents. They can be paid (x402). They can run work
confidentially (TEE inference). They can carry an identity and a reputation (ERC-8004, indexed).
Nothing connects them. You can pay an agent and get *an* answer, but nothing proves it is the answer
to *your* question, computed on *your* data. Today two strangers close that gap with an NDA or a
platform sitting in the middle — someone who sees everything and vouches for both sides.

Mithra removes the middle by carrying one signed commitment through the whole job. The buyer hashes
her brief, her data and the terms into a single `intentHash` and signs it. She finds a seller by
querying a public registry — she is never handed his address — and sends the work encrypted to his
key. Inside the seller's binding code the payload is decrypted, the commitment is recomputed from
what actually arrived, and the two are compared. The model then runs inside a 0G Sealed Inference
enclave, so neither the seller nor the infrastructure carrying the job ever sees the brief. What
comes back is signed by the enclave, and the buyer's commitment rides inside the body that signature
covers. A contract on Base recovers both signatures, checks that the commitment matched, and emits
a verdict. Payment settles only after that verdict exists — the authorisation is signed up front but
stays unsubmitted until the chain has spoken.

The demonstration is the failure case, because that is the part a screenshot cannot fake. A button
makes the seller cheat — answer a job the buyer never ordered, forge the enclave's signature, or
invent an order she never signed — and each produces a different on-chain rejection code, live, in
about thirteen seconds. The work was done and the seller gets nothing: the settlement stage simply
never appears on the timeline.

Everything on the dashboard is real and checkable without asking us for anything. The agent registry
is a public one, and most of the agents indexed there are not ours. The reputation counter has no
review endpoint — only a verified job can move it, and rejected attempts are indexed on the same
record, so cheating stays visible exactly where hiring decisions get made. Every job's lifecycle is
timestamped by Hedera consensus as commitments, never content. The deliverable is archived encrypted
on 0G Storage, so the hash the contract ruled on points at something anyone can fetch and only the
buyer can read. A downloadable proof bundle carries the raw material and the commands to verify the
signatures yourself.

What we do not claim. We did not build the TEE — 0G did; we bind it to the buyer's intent. Because
no TDX host was available for our own enclave, the match check runs in unattested code: the buyer
can verify it independently, a stranger cannot, and closing that gap is the next step rather than
something we are hiding. The binding catches task substitution and input tampering, not prompt
injection. The reputation is expensive and visible to fake, not impossible. And confidential agent
payments are not ours to claim first — what is new is all of it in one job, tied by a single
commitment, which is the only reason a chain can rule on work it never sees.

Everything runs on testnets: Base Sepolia, 0G Galileo, Hedera testnet, and a live subgraph.
