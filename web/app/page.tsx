import CinematicHero from "@/components/CinematicHero";
import SiteHeader from "@/components/SiteHeader";
import ThesisSection from "@/components/ThesisSection";
import HowItWorksSection from "@/components/HowItWorksSection";
import ArchitectureSection from "@/components/ArchitectureSection";
import TracksSection from "@/components/TracksSection";
import FraudDemoTeaser from "@/components/FraudDemoTeaser";
import CtaFooter from "@/components/CtaFooter";
import { ThemeProvider } from "@/lib/theme";

export default function Home() {
  return (
    <ThemeProvider>
      <SiteHeader />
      <CinematicHero />
      <ThesisSection />
      <HowItWorksSection />
      <ArchitectureSection />
      <TracksSection />
      <FraudDemoTeaser />
      <CtaFooter />
    </ThemeProvider>
  );
}
