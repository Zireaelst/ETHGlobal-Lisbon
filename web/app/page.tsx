import CinematicHero from "@/components/CinematicHero";
import SiteHeader from "@/components/SiteHeader";
import { ThemeProvider } from "@/lib/theme";

export default function Home() {
  return (
    <ThemeProvider>
      <SiteHeader />
      <CinematicHero />
    </ThemeProvider>
  );
}
