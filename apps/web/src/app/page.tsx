import { fetchItems, type ApiItem } from "@/lib/api";
import HeroSection from "@/components/home/HeroSection";
import StatsStrip from "@/components/home/StatsStrip";
import CategoryStrip from "@/components/home/CategoryStrip";
import DiscoveryFeedSection from "@/components/home/DiscoveryFeedSection";
import LocalBand from "@/components/home/LocalBand";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import ProtectedBand from "@/components/home/ProtectedBand";
import FinalCtaSection from "@/components/home/FinalCtaSection";

export default async function Home() {
  let items: ApiItem[] = [];
  try {
    const result = await fetchItems();
    items = result.items;
  } catch {
    items = [];
  }

  const active = items.filter((i) => i.status === "ACTIVE");

  return (
    <>
      <HeroSection />
      <StatsStrip />
      <CategoryStrip />
      <DiscoveryFeedSection items={active} />
      <LocalBand />
      <HowItWorksSection />
      <ProtectedBand />
      <FinalCtaSection />
    </>
  );
}
