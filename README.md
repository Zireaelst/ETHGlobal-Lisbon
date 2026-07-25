# Confidential Agents — ETHGlobal Lisbon 2026

Two independent AI agents — **Alice** (client) and **Bob** (expert analyst) — discover each
other through a public **ERC-8004** registry, then keep the whole relationship private: what
was said, who was paid, and the work itself. The result is verifiable on-chain, and it is
provably *the job Alice ordered*.

**Tracks:** 0G · The Graph · Hedera. 100% testnet. See [`CLAUDE.md`](./CLAUDE.md) for the full
architecture, confirmed technical spec, and phase-by-phase build plan.

## Status: Phase 0 (de-risk spike) — 2/5 legs green

| Leg | Status | Result |
|---|---|---|
| (a) 0G Sealed Inference call | 🔴 Blocked | The 0G compute ledger requires a 3 OG minimum balance to open an account; testnet faucet only grants 0.05 OG. Needs a 0G mentor for a testnet compute credit. |
| (b) Tapp binding path | 🟡 Partial | Seal-key signing scheme confirmed byte-for-byte from `agent-wrapper` source and proven correct via local simulation (`scripts/recover.js` recovers the right signer). Real TDX Tapp hosting still blocked — the public repo has no buildable entrypoint or image. |
| (c) Faucet budget measurement | 🔴 Blocked | Depends on (a). |
| (d) Hedera x402 end-to-end | 🟢 Green | Real 402 → pay → 200 round trip on Hedera testnet via the blocky402 facilitator, confirmed on-chain. |
| (e) ERC-8004 register + read | 🟢 Green | Registered and read back against the canonical registry on Base Sepolia. |

Per the project's own fallback rule, neither blocked leg is "proven dead" — both are external
access problems (faucet/mentor), not design failures — so no fallback has been triggered and
Phase 1 feature work is on hold pending (a)/(b).

## Repo layout

See `CLAUDE.md` §7. Spike scripts proving each Phase 0 leg live under `scripts/spikes/`.
