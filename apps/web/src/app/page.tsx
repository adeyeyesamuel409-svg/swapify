import { fetchItems, type ApiItem } from "@/lib/api";
import HeroSection from "@/components/home/HeroSection";
import StatsStrip from "@/components/home/StatsStrip";
import CategoryAnchors from "@/components/home/CategoryAnchors";
import DiscoveryFeedSection from "@/components/home/DiscoveryFeedSection";
import LocalCommunityBand from "@/components/home/LocalCommunityBand";
import HowItWorksProtectedBand from "@/components/home/HowItWorksProtectedBand";
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
      <CategoryAnchors />
      <DiscoveryFeedSection items={active} />
      <LocalCommunityBand />
      <HowItWorksProtectedBand />
      <FinalCtaSection />
    </>
  );
}
