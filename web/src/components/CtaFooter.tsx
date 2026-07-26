import { GitBranch } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SponsorLogo, type SponsorId } from "@/components/SponsorLogo";
import { GlowButton } from "@/components/ui/glow-button";

const SPONSORS: SponsorId[] = ["0g", "thegraph", "hedera", "base"];

/**
 * The honest-boundaries text is a claim ledger, not fine print — so it is
 * laid out as one, three parallel columns instead of a grey paragraph a
 * reader's eye slides off.
 */
const BOUNDARIES = [
  {
    claim: "Reputation",
    body: "Feedback anchored to paid, verified jobs. Inflating it is expensive, not impossible — this is not Sybil-proof.",
  },
  {
    claim: "The binding",
    body: "Catches task substitution and input tampering. It does not solve prompt injection.",
  },
  {
    claim: "Attestation",
    body: "One enclave, and 0G built it. Signatures are verified on-chain; match is computed off-enclave, so it is client-verifiable, not yet third-party-verifiable.",
  },
];

export default function CtaFooter() {
  return (
    <footer className="section px-8 py-24 sm:px-16 sm:py-32">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 text-center">
        <Reveal>
          <GlowButton href="https://github.com/Zireaelst/ETHGlobal-Lisbon">
            <GitBranch className="h-4 w-4" strokeWidth={1.5} />
            Explore the repo
          </GlowButton>
        </Reveal>
      </div>

      <div className="mx-auto mt-20 max-w-5xl">
        <Reveal>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            What we do not claim
          </div>
        </Reveal>

        <dl className="mt-8 grid grid-cols-1 gap-8 border-t border-border pt-8 sm:grid-cols-3">
          {BOUNDARIES.map((item, i) => (
            <Reveal key={item.claim} delay={i * 100}>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70">
                  {item.claim}
                </dt>
                <dd className="mt-3 font-body text-[13px] font-extralight leading-relaxed text-muted-foreground">
                  {item.body}
                </dd>
              </div>
            </Reveal>
          ))}
        </dl>

        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 sm:flex-row">
          <span className="font-display text-sm uppercase tracking-[0.18em] text-foreground">
            Mithra
          </span>
          {/* Four networks, in the order one job touches them: the compute, the
              read layer, the timeline, the verdict. Base earns its place here
              even though it is not one of the three tracks — it holds the
              verdict, and a footer that named only the tracks would misdescribe
              the run. */}
          <ul className="flex list-none flex-wrap items-center justify-center gap-x-7 gap-y-4 p-0">
            {SPONSORS.map((id) => (
              <li key={id} className="flex items-center">
                <SponsorLogo id={id} className="h-4 sm:h-[18px]" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
