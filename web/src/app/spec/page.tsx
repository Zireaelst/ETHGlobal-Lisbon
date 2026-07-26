// The spec page — where "Read the spec" in the hero lands.
//
// The landing page argues; this page is meant to be checkable. Every preimage, address and
// number below is the one the code actually uses, so a reader can hold this page beside
// `packages/shared/src/` and find no daylight between them. Where a thing is NOT proven, it
// says so in the same typeface as everything else — §7 is not a disclaimer at the bottom,
// it is a section with the same weight as the rest.

import type { Metadata } from "next";
import { ThemeProvider } from "@/lib/theme";
import SiteHeader from "@/components/SiteHeader";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Spec — Mithra",
  description:
    "The confirmed technical spec: what gets signed, the two signatures, the on-chain verdict, and the one thing we do not claim.",
};

const SECTIONS = [
  { id: "intent", n: "01", label: "What gets signed" },
  { id: "signatures", n: "02", label: "The two signatures" },
  { id: "verdict", n: "03", label: "The on-chain verdict" },
  { id: "binding", n: "04", label: "The binding we shipped" },
  { id: "money", n: "05", label: "Money, and its ordering" },
  { id: "timeline", n: "06", label: "The timeline" },
  { id: "check", n: "07", label: "Check it yourself" },
  { id: "boundaries", n: "08", label: "What we do not claim" },
];

/** A section heading with its number, so the page can be cited by number in a demo. */
function H({ id, n, children }: { id: string; n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-mono text-[11px] tracking-[0.28em] text-warm">{n}</span>
      <h2
        id={id}
        className="scroll-mt-28 font-display text-2xl font-light leading-tight text-foreground sm:text-3xl"
      >
        {children}
      </h2>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-2xl font-body text-[15px] font-extralight leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/** Preimages and addresses. Wrapped in its own scroller so a long hash never widens the page. */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl overflow-x-auto rounded-md border border-border bg-fill p-4">
      <pre className="font-mono text-[12px] leading-relaxed whitespace-pre text-foreground">
        {children}
      </pre>
    </div>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <em className="font-normal not-italic text-foreground">{children}</em>;
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="flex flex-col gap-5 border-t border-border pt-12">{children}</section>;
}

export default function SpecPage() {
  return (
    <ThemeProvider>
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl px-6 pb-32 pt-32 sm:px-10">
        <header className="flex flex-col gap-7">
          <Reveal immediate>
            <SectionEyebrow tint="warm">Specification</SectionEyebrow>
          </Reveal>
          <Reveal delay={80} immediate>
            <h1 className="max-w-3xl font-display text-4xl font-light leading-[1.1] tracking-tight text-foreground sm:text-5xl">
              One signed intent, carried from the payment through the enclave into the verdict.
            </h1>
          </Reveal>
          <Reveal delay={160} immediate>
            <P>
              Payment, execution and reputation are each solved for agents; nothing connects
              them. What follows is the whole connection — every preimage, every recovery, and
              the one link we could not close. It is written to be checked against the code, not
              to be believed.
            </P>
          </Reveal>

          <Reveal delay={240} immediate>
            <nav className="mt-4 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="group flex items-baseline gap-3 font-body text-[13px] font-light text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="font-mono text-[10px] tracking-[0.22em] text-warm/70">
                    {s.n}
                  </span>
                  {s.label}
                </a>
              ))}
            </nav>
          </Reveal>
        </header>

        <div className="mt-20 flex flex-col gap-16">
          <Section>
            <H id="intent" n="01">What gets signed</H>
            <P>
              Alice commits to the job before anyone is paid and before any work starts. The
              commitment is a single hash over the brief, the data, the constraints, the price
              and a nonce — so a job differing in any one of those is a different hash.
            </P>
            <Code>{`intentHash = keccak256(
  abi.encode(briefHash, dataHash, constraints, price, nonce)
)`}</Code>
            <P>
              She signs that hash with <Term>EIP-712</Term>. The contract later recovers{" "}
              <Term>her own</Term> signer and compares it against the registered client — it
              never trusts an intent-and-output pair that Bob hands it, because Bob has every
              reason to hand it a matching pair.
            </P>
            <P>
              The brief and the data themselves travel <Term>ECIES-encrypted</Term> to Bob&apos;s
              registered public key. What is public is the commitment; what is private is the
              job.
            </P>
          </Section>

          <Section>
            <H id="signatures" n="02">The two signatures</H>
            <P>
              Both are ecrecover-compatible, and they prove different things. Confusing them is
              the easiest way to overstate this project, so they are stated separately.
            </P>

            <h3 className="mt-2 font-display text-lg font-normal text-foreground">
              A · 0G&apos;s TEE signature — a genuine enclave produced this output
            </h3>
            <P>
              Measured, not assumed: the signed message is <Term>not</Term> the output text. It
              is a colon-joined tuple in which the output appears as the sha256 of the raw
              response body.
            </P>
            <Code>{`"<h1>:<sha256(raw response body)>:<ProviderType>:<ProviderIdentity>:<h3>"

verify:  recoverAddress(hashMessage(text), signature) === teeSignerAddress`}</Code>
            <P>
              So the output <Term>is</Term> covered — as the fingerprint of the body containing
              it, not as plain text. Same guarantee against tampering; a different sentence, and
              we use the accurate one. A one-byte change to the body drops out of the tuple.
              Hash the <Term>raw bytes</Term>: a JSON re-stringify depends on key order and would
              break silently the day the provider reorders a field.
            </P>
            <P>
              Two further conditions the code enforces rather than assumes: the chat id comes
              from the <Term>ZG-Res-Key</Term> response header, and{" "}
              <Term>teeSignerAcknowledged</Term> must be true — a TeeML provider whose signer the
              contract owner has not vouched for is the provider&apos;s own claim, and we refuse
              to verify against it.
            </P>

            <h3 className="mt-4 font-display text-lg font-normal text-foreground">
              B · The binding signature — this code checked the match
            </h3>
            <Code>{`preimage  = keccak256("agentId|sealId|timestamp|hex(sha256(body))")
signature = 64-byte R‖S, no EIP-191 prefix — v is discarded by the wrapper
            → brute-force v ∈ {27,28} off-chain, pass v into the contract`}</Code>
            <P>
              The body it signs must be <Term>byte-stable</Term>, because raw bytes are what get
              hashed; nothing is re-stringified before verification.
            </P>
          </Section>

          <Section>
            <H id="verdict" n="03">The on-chain verdict</H>
            <P>
              <Term>Verifier.sol</Term> on Base Sepolia is the only thing that decides. It does
              three checks and refuses the job unless all three pass:
            </P>
            <Code>{`1.  reconstruct the binding preimage, recover the signer
    require signer == enclaveSignerOf[agentId]

2.  recover Alice's EIP-712 signer
    require signer == registeredClient

3.  require match == true

→   emit JobVerified(intentHash, outputHash)`}</Code>
            <P>
              A job that fails is not silently dropped — it emits a rejection with a reason, and
              the subgraph indexes those too, so a cheating attempt stays visible exactly where
              hiring decisions are made. The four ways Bob can cheat, and what each one trips:
            </P>
            <Code>{`substitute   he answers a different job     → MatchFalse
tamper       he edits the input            → MatchFalse
forge        he rewrites the signed body   → BadEnclaveSig
selfintent   he supplies his own intent    → BadClientSig`}</Code>
          </Section>

          <Section>
            <H id="binding" n="04">The binding we shipped</H>
            <P>
              This is the section to read if you only read one. Bob&apos;s binding — the code
              that recomputes the hash and decides <Term>match</Term> — runs on an{" "}
              <Term>ordinary host</Term>, not in an attested enclave. We had no TDX machine and
              0G does not host that execution for us.
            </P>
            <P>
              Rather than fake an attestation, we moved one end of the binding inside 0G&apos;s
              real enclave:
            </P>
            <Code>{`Alice signs intentHash
  → it is placed at the TOP of the prompt
  → the model copies it verbatim into its answer
  → 0G's TEE signs sha256(response body), which CONTAINS that answer

⇒ a genuine 0G enclave has attested:
  "a response carrying THIS intentHash was produced in here"`}</Code>
            <P>
              Bob cannot forge that first link on his own machine — it comes from 0G hardware.
              The echo is checked against the <Term>raw output</Term> by our own code, not by the
              compute backend, because a backend could simply claim it inserted the commitment.
              Verification is exact-match on the full 64-hex value: one shifted character breaks
              it, and &quot;close enough&quot; is not a category. Measured 5/5 verbatim.
            </P>
            <P>
              What that does <Term>not</Term> give you: the match check itself is computed by
              unattested code. Alice can verify it independently; a stranger cannot.{" "}
              <Term>attestation: &apos;none&apos;</Term> and <Term>imageHash: null</Term> stay in
              the code and in the UI until that changes. The honest sentence is: 0G attests the
              compute and carries the intent through it; the match check is client-verifiable,
              not yet third-party-verifiable.
            </P>
          </Section>

          <Section>
            <H id="money" n="05">Money, and its ordering</H>
            <P>
              Bob answers <Term>HTTP 402</Term> until he is paid, and does no work before the
              authorisation exists. But the authorisation is not the payment: money moves only
              after the contract has ruled.
            </P>
            <Code>{`Alice authorizes x402      → nothing has moved yet
Verifier emits JobVerified → the job is ruled valid
Bob calls /settle          → the guard RE-READS that receipt on chain
                             for THIS intentHash, then releases`}</Code>
            <P>
              The guard is structural rather than a convention each backend is trusted to
              follow. Checking merely that a transaction hash was supplied would let Bob invent
              one; reading the event makes that impossible. A rejected job never reaches the
              settle line, and the signed authorisation is never submitted.
            </P>
            <P>Two rails, and the receipt reports which one you got rather than asserting it:</P>
            <Code>{`base-stealth   paidTo is a fresh ERC-5564 address, different every job
               paidTo ≠ agentIdentity — the payment record does not name Bob

hedera-x402    paidTo == agentIdentity, the account published in his agent card
               this rail buys autonomy, not privacy, and says so`}</Code>
            <P>
              Two addresses a reader can compare beat a <Term>private: true</Term> flag they
              would have to take our word for. The limit, stated before someone works it out
              unaided: on this testnet there is one client and one agent, and JobVerified names
              the agentId, so timing correlation still links a payout to Bob. What the stealth
              address hides is the payment record, not the whole system.
            </P>
          </Section>

          <Section>
            <H id="timeline" n="06">The timeline</H>
            <P>
              Every stage — quote, intent, enclave, output, settlement — is committed to a Hedera
              Consensus Service topic, <Term>including the rejections</Term>. The timestamps
              shown in the demo are Hedera&apos;s own consensus timestamps, read back from the
              public mirror node; a timeline whose times come from the machine that wrote it
              proves nothing.
            </P>
            <P>
              What goes on the topic is <Term>commitments only</Term> — hashes, stage names,
              flags. The brief, the data and the output never go near it, and the code scans its
              own outgoing messages for those secrets before they reach the network.
            </P>
          </Section>

          <Section>
            <H id="check" n="07">Check it yourself</H>
            <P>
              Nothing here needs our word for it. Each of these is a public address on a public
              testnet.
            </P>
            <div className="max-w-2xl overflow-x-auto">
              <table className="w-full border-collapse font-body text-[13px] font-light">
                <tbody className="text-muted-foreground">
                  {[
                    ["Verifier · Base Sepolia", "0x3B116D648B710f551e37223c4c4d39879AFEEb96"],
                    ["ERC-8004 registry · Base Sepolia", "0x8004A818BFB912233c491871b3d84c89A494BD9e"],
                    ["Agent ids", "Bob 8429 · Alice 8431"],
                    ["0G provider · Galileo, chainId 16602", "0xa48f01287233509FD694a22Bf840225062E67836"],
                    ["Model · attestation", "qwen/qwen2.5-omni-7b · TeeML"],
                    ["0G TEE signer", "0x83df4B8EbA7c0B3B740019b8c9a77ffF77D508cF"],
                    ["Hedera timeline topic", "0.0.9738448"],
                    ["Subgraph", "confidential-agents (The Graph Studio)"],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-b border-border align-top">
                      <td className="py-3 pr-6 whitespace-nowrap">{k}</td>
                      <td className="py-3 font-mono text-[11.5px] break-all text-foreground">
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <P>
              Or run it. Every phase has a gate that proves it against live networks, and the
              recorded evidence is checked in so the gates cost no faucet credit.
            </P>
            <Code>{`pnpm demo:base                    a full job, no payment rail
pnpm demo:base -- --fraud substitute
                                  rejected on chain, nothing settles

pnpm gate:P3-D    an honest run verifies; three fraud modes are
                  rejected ON CHAIN — MatchFalse, BadEnclaveSig, BadClientSig
pnpm gate:P1-D    the fourth, tamper, which shares the MatchFalse path
pnpm measure:e2e  re-measure end-to-end latency`}</Code>
            <P>
              Measured end to end over 5 runs with no payment rail:{" "}
              <Term>p50 21.0 s, p95 22.7 s</Term> against a 60 s budget. The dominant term is the
              0G inference call, about 12.4 s.
            </P>
          </Section>

          <Section>
            <H id="boundaries" n="08">What we do not claim</H>
            <P>
              A spec that only lists what works is a brochure. These are the limits we hold
              ourselves to, and we would rather say them than have them found.
            </P>
            <ul className="flex max-w-2xl list-none flex-col gap-4 p-0">
              {[
                [
                  "Not Sybil-proof reputation",
                  "Feedback anchored to paid, verified jobs. Inflating it is expensive, not impossible.",
                ],
                [
                  "Not a solution to prompt injection",
                  "The binding catches task substitution and input tampering. That is the whole claim.",
                ],
                [
                  "Not two TEEs",
                  "One, and 0G built it. Bob's binding runs on an ordinary host — see §04.",
                ],
                [
                  "Not decentralized compute",
                  "The provider we pinned reports ProviderType: centralized, ProviderIdentity: aliyun. The TEE seal is real Intel TDX; the operator is a single cloud.",
                ],
                [
                  "Not private on Hedera",
                  "The Hedera run buys autonomy. Recipient privacy is the Base run's stealth rail.",
                ],
                [
                  "Not first",
                  "Confidential agent payments shipped before us. The intent binding is what is ours.",
                ],
                [
                  "Not “the AI decided, therefore it is trustworthy”",
                  "The agents' brain is unattested and outside every guarantee here. It can refuse to trade; it cannot overpay, invent a counterparty, or make an invalid job verify. If the brain and the contract disagree, the contract is the one that decided.",
                ],
                [
                  "Not “Claude runs the analysis”",
                  "Claude decides; 0G Sealed Inference produces the deliverable. Swapping the brain cannot change one byte of what the enclave signed.",
                ],
              ].map(([claim, body]) => (
                <li key={claim} className="border-l border-border pl-5">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                    {claim}
                  </div>
                  <div className="mt-2 font-body text-[13px] font-extralight leading-relaxed text-muted-foreground">
                    {body}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="mt-20 flex flex-wrap items-center gap-6 border-t border-border pt-10">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-3 rounded-full border border-border bg-fill px-7 py-3.5 font-body text-[13px] font-light uppercase tracking-[0.1em] text-foreground transition-colors hover:border-foreground/40"
          >
            Watch it run
          </a>
          <a
            href="https://github.com/Zireaelst/ETHGlobal-Lisbon"
            className="font-body text-[13px] font-light tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Read the source
          </a>
        </div>
      </main>
    </ThemeProvider>
  );
}
