# How it's made — submission copy

Paste target: the ETHGlobal "How it's made" field (min 280 characters). One text for the project;
if the form is filled per track, move that sponsor's paragraph up and leave the rest as context.

---

TypeScript monorepo (pnpm workspaces), Foundry for the contract, Next.js for the demo dApp. Two
agents — a buyer and a seller — run as separate HTTP servers and never share a process. Everything
between them is an ECIES envelope (eth-crypto); the seller's outer layer holds ciphertext and no
key, because decryption lives in a separate package that the outer layer depends on one-way. A gate
test asserts that direction and greps the binding package for any cheat switch, so "the seller
cannot make the enclave lie" is a checked invariant rather than a claim.

The core is one commitment. The buyer signs `intentHash = keccak256(abi.encode(briefHash, dataHash,
constraints, price, nonce))` with EIP-712. The binding recomputes it from the decrypted payload,
compares, and signs a body that is `abi.encode(bytes32,bytes32,bool,bytes32)` — not JSON, so
Verifier.sol rebuilds it from fields instead of parsing. The contract recovers both signatures and
emits JobVerified or JobRejected with one of four codes.

**0G** runs the model in Sealed Inference (`@0gfoundation/0g-compute-ts-sdk`): pin a TeeML provider
that is `teeSignerAcknowledged` on chain, fetch single-use request headers, POST /chat/completions.
Two things cost us hours and are worth writing down. First, the TEE signature does **not** sign the
answer text — it signs a colon-joined tuple containing the **sha256 of the raw response body**. We
found that by hashing every candidate against the digest until only the raw bytes matched, and it
means you must keep the raw response: a `JSON.parse` → `JSON.stringify` round trip silently breaks
verification the day the provider reorders a key. Second, the chat id comes from the `ZG-Res-Key`
response header; `completion.id` returns `chat_id_not_found`.

The hackiest and most useful thing we did: no TDX host was available for our own enclave, so instead
of faking an attestation we moved one end of the binding *inside* 0G's. The buyer's signed
`intentHash` is placed at the top of the prompt, the model copies it verbatim into the answer, and
0G's hardware signs a digest of a body that contains it. Measured 5/5 verbatim. The echo is checked
by our binding against the raw output — deliberately not by the compute backend, since a backend
could simply claim it inserted the commitment. The deliverable is then archived on 0G Storage,
AES-256-GCM, with the locally computed merkle root compared against the one the network returns.

**The Graph** is the read layer, and the seller's address is never handed to the buyer — she queries
a subgraph by skill and ranks by deliveries a contract confirmed. Two indexing details: agent
metadata arrives in a separate `MetadataSet` event rather than in `Registered`, so indexing only
registrations yields agents with no skill and no endpoint; and `MetadataSet`'s indexed key is an
`indexed string`, so the topic carries its hash, not its value. Reputation is unwritable by design —
there is no review endpoint, and only a `JobVerified` event can move the counter. Rejected attempts
are indexed on the same record, so cheating stays visible where hiring decisions are made.

**Hedera** carries payment and the timeline. Payment is x402 (`@x402/hedera`, blocky402 testnet
facilitator) with the verify/settle split doing real work: the buyer's authorisation is signed but
unsubmitted, and settlement is refused unless a JobVerified transaction is supplied and checked.
HCS records every stage as a commitment, never content. Consensus order follows submission order, so
the writes are sequential — we append and flush rather than parallelise. On a fraud run the SETTLED
stage simply never appears, which is the argument recorded on a chain that is not ours to edit.

**Base** holds the verdict, and one detail forced a workaround: the wrapper's seal signature
discards `v`, putting only r‖s on the wire. We brute-force `v ∈ {27,28}` off chain and pass the
parity in — and the downloadable proof bundle publishes both recovered candidates, so nobody has to
trust which one we picked. The Base payment run pays a fresh ERC-5564 stealth address per job, so
the payout does not name the seller; the Hedera run deliberately does not, and we say so.

Testing is a per-phase gate with binary criteria and an exit code. A recording proxy sits between
the two agents and the leak scan searches the captured traffic for the plaintext in **both** plain
and hex-encoded 16-character windows, because the body is hex ciphertext and that is where a leak
would actually show. Recorded real 0G responses can be replayed with the signature re-verified on
every replay — labelled `fixture-replay`, never called a mock, because it is a recording of a real
call and the difference matters.

The honest gap: with no TDX host, the recompute runs in unattested code. The client can verify the
match independently; a stranger cannot. Closing that is a deployment, not a redesign — the binding
is already a pure function with no environment reads.
