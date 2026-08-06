import TokensClient from "@/components/TokensClient";

export const metadata = { title: "Buy Tokens - Swapify" };

export default async function TokensPage({ searchParams }: { searchParams: Promise<{ paid?: string }> }) {
  const { paid } = await searchParams;
  return <TokensClient paid={paid === "1"} />;
}
