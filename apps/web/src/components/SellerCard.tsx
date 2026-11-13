import { fetchUserProfile } from "@/lib/api";
import { mockVerified } from "@/lib/mock";
import StarRating from "./StarRating";
import TrustBadges from "./TrustBadges";

type Props = {
  sellerId: string;
  sellerName: string;
  sellerImageUrl: string | null;
};

export default async function SellerCard({ sellerId, sellerName, sellerImageUrl }: Props) {
  let profile: Awaited<ReturnType<typeof fetchUserProfile>> | null = null;
  try {
    profile = await fetchUserProfile(sellerId);
  } catch {
    profile = null;
  }

  const memberSince = profile ? new Date(profile.user.createdAt) : null;
  const avg = profile?.rating.averageScore ?? null;
  const ratingTotal = profile?.rating.total ?? 0;
  const completedSwaps = profile?.completedSwaps ?? 0;
  const verified = mockVerified(sellerId);

  return (
    <div className="mt-6 rounded-card border border-line bg-surface p-5 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">About the seller</p>
      <div className="mt-3 flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2">
          {sellerImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sellerImageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-primary-soft">{sellerName.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy">{sellerName}</p>
          <div className="mt-1">
            <TrustBadges verified={verified} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {avg !== null ? (
              <>
                <StarRating score={avg} />
                <span className="font-semibold text-token">{avg.toFixed(1)}</span>
                <span className="text-muted/70">
                  · {ratingTotal} rating{ratingTotal === 1 ? "" : "s"}
                </span>
              </>
            ) : (
              "No ratings yet"
            )}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-btn bg-surface-2 p-3">
          <p className="text-lg font-bold text-token">{completedSwaps}</p>
          <p className="text-xs text-muted">Completed swaps</p>
        </div>
        <div className="rounded-btn bg-surface-2 p-3">
          <p className="text-lg font-bold text-foreground">
            {memberSince ? memberSince.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "New"}
          </p>
          <p className="text-xs text-muted">Member since</p>
        </div>
      </div>
    </div>
  );
}
