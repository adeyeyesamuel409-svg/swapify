import { fetchItems, type ApiItem } from "@/lib/api";
import HeroSection from "@/components/home/HeroSection";
import FeaturedSection from "@/components/home/FeaturedSection";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import CategoriesSection from "@/components/home/CategoriesSection";
import TokensExplainerSection from "@/components/home/TokensExplainerSection";
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
  const featured = active.slice(0, 6);

  return (
    <>
      <HeroSection items={active} />
      <FeaturedSection items={featured} />
      <HowItWorksSection />
      <CategoriesSection />
      <TokensExplainerSection items={active} />
      <FinalCtaSection />
    </>
  );
}
