import { fetchItems, type ApiItem } from "@/lib/api";
import HeroSection from "@/components/home/HeroSection";
import DiscoveryFeedSection from "@/components/home/DiscoveryFeedSection";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import CategoriesSection from "@/components/home/CategoriesSection";
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
      <DiscoveryFeedSection items={active} />
      <HowItWorksSection />
      <CategoriesSection />
      <FinalCtaSection />
    </>
  );
}
