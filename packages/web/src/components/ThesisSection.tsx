import { Reveal } from "@/components/Reveal";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { TextReveal } from "@/components/ui/text-reveal";

export default function ThesisSection() {
  return (
    <section
      id="thesis"
      className="section flex justify-center px-8 py-40 sm:px-16 md:py-56"
    >
      <div className="flex max-w-3xl flex-col gap-7">
        <Reveal>
          <SectionEyebrow tint="warm">The problem</SectionEyebrow>
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
