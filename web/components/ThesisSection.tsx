import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/ui/badge";

export default function ThesisSection() {
  return (
    <section
      id="thesis"
      className="section flex justify-center px-8 py-32 sm:px-16 md:py-48"
    >
      <Reveal className="flex max-w-3xl flex-col gap-6">
        <Badge className="w-fit text-warm">The problem</Badge>

        <p className="font-display text-3xl font-light leading-[1.25] tracking-tight text-foreground sm:text-4xl md:text-5xl">
          Payment, execution and reputation are each solved for agents, but
          nothing connects them.
        </p>

        <p className="max-w-xl font-body text-lg font-extralight leading-relaxed text-muted-foreground">
          We carry one signed intent hash from payment, through the enclave,
          to reputation —{" "}
          <em className="font-normal not-italic text-foreground">
            intent-bound verification
          </em>
          .
        </p>
      </Reveal>
    </section>
  );
}
