import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { fetchWishlists, fetchWishlistMatches, type ApiItem, type ApiWishlist } from "@/lib/api";
import WishlistsClient from "@/components/WishlistsClient";

export const metadata = { title: "My Wishlists - Swapify" };

export default async function WishlistsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/wishlists")}`);

  let wishlists: ApiWishlist[] = [];
  try {
    ({ wishlists } = await fetchWishlists(session.accessToken));
  } catch {
    wishlists = [];
  }

  const withMatches = await Promise.all(
    wishlists.map(async (w: ApiWishlist) => {
      try {
        const { matches } = await fetchWishlistMatches(session.accessToken!, w.id);
        return { ...w, matches };
      } catch {
        return { ...w, matches: [] as ApiItem[] };
      }
    }),
  );

  return <WishlistsClient wishlists={withMatches} accessToken={session.accessToken} />;
}
