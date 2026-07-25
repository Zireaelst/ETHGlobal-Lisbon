import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

const TRACKS = [
  {
    name: "0G",
    detail:
      "Sealed Inference — the model runs inside a TeeML TEE via @0gfoundation/0g-compute-ts-sdk; output is signed by the enclave.",
  },
  {
    name: "The Graph",
    detail:
      "ERC-8004 registry index + JobVerified verified-delivery count, forked from the agent0lab subgraph and deployed live to Subgraph Studio.",
  },
  {
    name: "Hedera",
    detail:
      "@x402/hedera exact-scheme payment via the blocky402 testnet facilitator, settled after verification; HCS records the off-chain timeline as commitments.",
  },
];

export default function TracksSection() {
  return (
    <section id="tracks" className="section px-8 py-32 sm:px-16 md:py-40">
      <Reveal>
        <Badge className="w-fit text-cool">Tracks</Badge>
      </Reveal>

      <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {TRACKS.map((track, i) => (
          <Reveal key={track.name} delay={i * 120}>
            <Card className="h-full">
              <CardTitle>{track.name}</CardTitle>
              <CardDescription>{track.detail}</CardDescription>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
