import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/ui/badge";
import { TextReveal } from "@/components/ui/text-reveal";

export default function ThesisSection() {
  return (
    <section
      id="thesis"
      className="section relative flex justify-center overflow-hidden px-8 py-32 sm:px-16 md:py-48"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[720px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-[0.12] blur-[100px]"
        style={{
          background:
            "radial-gradient(closest-side, var(--chap-warm), transparent 70%)",
        }}
      />

      <div className="relative flex max-w-3xl flex-col gap-6">
        <Reveal>
          <Badge className="w-fit text-warm">The problem</Badge>
        </Reveal>

        <TextReveal
          text="Payment, execution and reputation are each solved for agents, but nothing connects them."
          className="font-display text-3xl font-light leading-[1.25] tracking-tight text-foreground sm:text-4xl md:text-5xl"
        />

        <Reveal delay={200}>
          <p className="max-w-xl font-body text-lg font-extralight leading-relaxed text-muted-foreground">
            We carry one signed intent hash from payment, through the
            enclave, to reputation —{" "}
            <em className="font-normal not-italic text-foreground">
              intent-bound verification
            </em>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}
