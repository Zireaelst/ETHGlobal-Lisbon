import CinematicHero from "@/components/CinematicHero";
import SiteHeader from "@/components/SiteHeader";
import ThesisSection from "@/components/ThesisSection";
import HowItWorksSection from "@/components/HowItWorksSection";
import ArchitectureSection from "@/components/ArchitectureSection";
import IntentPlaygroundSection from "@/components/IntentPlaygroundSection";
import FraudDemoSection from "@/components/FraudDemoSection";
import TracksSection from "@/components/TracksSection";
import CtaFooter from "@/components/CtaFooter";
import { SectionDivider } from "@/components/SectionDivider";
import { ThemeProvider } from "@/lib/theme";

/**
 * Three acts below the hero, each closed by a divider: the claim (thesis →
 * how it works → architecture), the proof (a clean run, then the same run
 * rejected), and the credits. Dividers only mark act breaks — one between
 * every section made them read as page furniture rather than punctuation.
 */
export default function Home() {
  return (
    <ThemeProvider>
      <SiteHeader />
      <CinematicHero />

      <ThesisSection />
      <HowItWorksSection />
      <ArchitectureSection />

      <SectionDivider />

      <IntentPlaygroundSection />
      <FraudDemoSection />

      <SectionDivider />

      <TracksSection />
      <CtaFooter />
    </ThemeProvider>
  );
}
