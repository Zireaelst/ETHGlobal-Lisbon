import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const NODES = [
  { label: "Alice-agent", detail: "discovers · signs intent · pays" },
  { label: "Bob's Tapp (TEE #1)", detail: "recomputes hash · checks match" },
  { label: "0G Sealed Inference (TEE #2)", detail: "runs the model" },
  { label: "Verifier.sol", detail: "checks both signatures on-chain" },
];

export default function ArchitectureSection() {
  return (
    <section id="architecture" className="section px-8 py-32 sm:px-16 md:py-40">
      <Reveal>
        <Badge className="w-fit text-warm">Architecture</Badge>
      </Reveal>

      <Reveal
        delay={120}
        className="mt-14 flex flex-col items-stretch gap-4 lg:flex-row lg:items-center lg:gap-3"
      >
        {NODES.map((node, i) => (
          <div key={node.label} className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-center">
            <Card className="min-w-[180px] p-5 hover:bg-fill">
              <div className="font-mono text-xs tracking-wide text-foreground">
                {node.label}
              </div>
              <div className="mt-2 font-body text-[13px] font-extralight text-muted-foreground">
                {node.detail}
              </div>
            </Card>
            {i < NODES.length - 1 && (
              <ArrowRight
                aria-hidden="true"
                strokeWidth={1.5}
                className="h-5 w-5 shrink-0 rotate-90 text-cool self-center lg:rotate-0"
              />
            )}
          </div>
        ))}
      </Reveal>

      <Reveal delay={240}>
        <p className="mt-10 font-mono text-xs tracking-wide text-muted-foreground">
          Base = the verdict · Hedera = the timeline · The Graph = the read
          layer · 0G = the compute.
        </p>
      </Reveal>
    </section>
  );
}
