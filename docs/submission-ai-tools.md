# AI tools — submission copy

Paste target: "Describe how AI tools were used in your project". Two separate things are worth
separating: AI inside the product, and AI used to build it.

---

**AI inside the product — two different jobs, labelled separately.**

The deliverable itself is produced by a model running in a 0G Sealed Inference enclave —
`qwen/qwen2.5-omni-7b` on a TeeML provider. That is the work being bought and sold, and it is the
only model whose output anything is signed over.

Separately, the two agents make their own decisions with a model rather than with a sort order.
Alice picks which seller to hire from the subgraph's shortlist, approves or refuses the price, and
reviews the delivered work. The backend is switchable (`REASONING_BACKEND`): `claude` runs Claude
Code headless on the operator's machine via `claude -p --output-format json`, `0g` routes the same
decisions through 0G Compute, and the default `policy` is a deterministic ranking with no model at
all. Whatever is chosen is reported: the run carries `computeProvider` for *who produced the
deliverable* and `reasoningProvider` for *who chose*, and the dashboard shows both, because they are
different questions.

The boundary around the decision layer is deliberate and enforced. It is unverified, unattested, and
outside every guarantee the project makes — nothing it says is signed by anything. It can only ever
*narrow* an outcome: refuse to trade, or reject work that the cryptography accepted. It cannot make
an invalid job verify, because the verdict is a contract recovering two signatures and checking a
hash. If the brain and the contract disagree, the contract is the one that decided. When the brain
is unavailable — rate limit, no network — a deterministic policy answers instead and the run reports
`fellBackFrom`, so a fallback is visible rather than silent.

**AI tools used to build it.**

Claude Code (Opus) was used throughout, as a pair rather than a generator. The parts where it earned
its place were the ones that needed measurement rather than recall: working out that 0G's TEE
signature covers a colon-joined tuple containing the sha256 of the *raw* response body rather than
the answer text — found by hashing every candidate against the digest until only the raw bytes
matched; tracking down that the chat id comes from the `ZG-Res-Key` header and not `completion.id`;
and diagnosing a deployment where a per-instance memory cache silently failed to be a shared one, so
the subgraph's query budget stayed exhausted.

It also wrote most of the phase gate tests, which is where the discipline came from rather than the
speed: each gate is a set of binary criteria with an exit code, and several of the honesty rules in
this project exist because a gate made an implicit claim explicit and then failed on it.
