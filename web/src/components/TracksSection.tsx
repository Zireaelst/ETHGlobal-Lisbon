import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { SponsorLogo, type SponsorId } from "@/components/SponsorLogo";
import { SpotlightCard } from "@/components/ui/spotlight-card";

const TRACKS: {
  id: SponsorId;
  name: string;
  role: string;
  detail: string;
  chips: string[];
  tint: "warm" | "cool";
}[] = [
  {
    id: "0g",
    name: "0G",
    role: "The compute",
    detail:
      "The model runs inside a TeeML enclave, and the enclave signs its own output. We bind that output to Alice's intent — we did not build the TEE.",
    chips: ["@0gfoundation/0g-compute-ts-sdk", "Sealed Inference", "TeeML"],
    tint: "warm",
  },
  {
    id: "thegraph",
    name: "The Graph",
    role: "The read layer",
    detail:
      "A fork of the agent0lab subgraph, deployed live to Subgraph Studio: it indexes the ERC-8004 registry for discovery and JobVerified for verified-delivery count.",
    chips: ["ERC-8004 registry", "JobVerified", "Subgraph Studio"],
    tint: "cool",
  },
  {
    id: "hedera",
    name: "Hedera",
    role: "The timeline",
    detail:
      "x402 exact-scheme payment through the blocky402 testnet facilitator, settled only after verification. HCS records the off-chain timeline as commitments — autonomy, not privacy.",
    chips: ["@x402/hedera", "blocky402 testnet", "HCS"],
    tint: "warm",
  },
];

export default function TracksSection() {
  return (
    <section id="tracks" className="section px-8 py-32 sm:px-16 md:py-40">
      <div className="mx-auto max-w-5xl">
        <Reveal>
          <SectionEyebrow tint="cool">Tracks</SectionEyebrow>
        </Reveal>

        <Reveal delay={80}>
          <h2 className="mt-6 max-w-2xl font-display text-4xl font-light tracking-tight text-foreground sm:text-5xl">
            Three networks. Three jobs. No overlap.
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {TRACKS.map((track, i) => (
            <Reveal key={track.name} delay={i * 120}>
              <SpotlightCard tint={track.tint} className="flex h-full flex-col">
                <div className="flex items-center justify-between gap-3">
                  {/* The lockup is the heading — a screen reader still hears the
                      sponsor's name, from the mark's own aria-label. */}
                  <h3 className="flex min-w-0 items-center">
                    <SponsorLogo id={track.id} className="h-6" />
                  </h3>
                  <span
                    className={
                      track.tint === "warm"
                        ? "font-mono text-[10px] uppercase tracking-[0.2em] text-warm"
                        : "font-mono text-[10px] uppercase tracking-[0.2em] text-cool"
                    }
                  >
                    {track.role}
                  </span>
                </div>

                <p className="mt-4 flex-1 font-body text-[14px] font-light leading-relaxed text-muted-foreground">
                  {track.detail}
                </p>

                <ul className="mt-7 flex list-none flex-wrap gap-2 p-0">
                  {track.chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-full border border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors duration-500 group-hover:border-foreground/25 group-hover:text-foreground/80"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
