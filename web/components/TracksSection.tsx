import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { SpotlightCard } from "@/components/ui/spotlight-card";

const TRACKS = [
  {
    name: "0G",
    detail:
      "Sealed Inference — the model runs inside a TeeML TEE via @0gfoundation/0g-compute-ts-sdk; output is signed by the enclave.",
    tint: "warm" as const,
  },
  {
    name: "The Graph",
    detail:
      "ERC-8004 registry index + JobVerified verified-delivery count, forked from the agent0lab subgraph and deployed live to Subgraph Studio.",
    tint: "cool" as const,
  },
  {
    name: "Hedera",
    detail:
      "@x402/hedera exact-scheme payment via the blocky402 testnet facilitator, settled after verification; HCS records the off-chain timeline as commitments.",
    tint: "warm" as const,
  },
];

export default function TracksSection() {
  return (
    <section id="tracks" className="section px-8 py-32 sm:px-16 md:py-40">
      <Reveal>
        <SectionEyebrow tint="cool">Tracks</SectionEyebrow>
      </Reveal>

      <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {TRACKS.map((track, i) => (
          <Reveal key={track.name} delay={i * 120}>
            <SpotlightCard tint={track.tint} className="h-full">
              <CardTitle>{track.name}</CardTitle>
              <CardDescription>{track.detail}</CardDescription>
            </SpotlightCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
