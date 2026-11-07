import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/auth";
import { fetchMe, fetchUserRatings } from "@/lib/api";
import { mockVerified } from "@/lib/mock";
import StarRating from "@/components/StarRating";
import TrustBadges from "@/components/TrustBadges";
import MyListings from "@/components/MyListings";
import PaymentMethodsSection from "@/components/PaymentMethodsSection";
import AddressBookSection from "@/components/AddressBookSection";
import BalanceSection from "@/components/BalanceSection";
import PayoutSetupSection from "@/components/PayoutSetupSection";
import WithdrawalForm from "@/components/WithdrawalForm";
import WithdrawalHistory from "@/components/WithdrawalHistory";

export const metadata = { title: "My Profile - Swapify" };

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session.accessToken) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/profile")}`);
  }

  let user: Awaited<ReturnType<typeof fetchMe>>["user"] | null = null;
  try {
    ({ user } = await fetchMe(session.accessToken));
  } catch {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-3 px-4 py-16 text-center sm:px-6">
        <p className="text-foreground">We couldn&apos;t load your profile right now.</p>
        <p className="text-sm text-muted">Please try again in a moment.</p>
      </main>
    );
  }
  const ratings = await fetchUserRatings(user.id).catch(() => null);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">My profile</h1>

      <div className="rounded-card border border-line bg-surface p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-navy">{user.name}</p>
            <p className="text-sm text-muted">{user.email}</p>
            <div className="mt-2">
              <TrustBadges verified={mockVerified(user.id)} size="md" />
            </div>
          </div>
          {ratings && ratings.total > 0 && (
            <div className="text-right">
              <StarRating score={ratings.averageScore ?? 0} size="h-4 w-4" />
              <p className="mt-1 text-xs text-muted">
                <span className="text-sm font-bold text-token">{ratings.averageScore?.toFixed(1)}</span> · {ratings.total} rating{ratings.total === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </div>
        {user.bio && <p className="mt-2 text-sm text-muted">{user.bio}</p>}
      </div>

      <MyListings accessToken={session.accessToken} />

      <section aria-label="Payments" className="flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-navy">Payments</h2>
          <p className="mt-1 text-sm text-muted">
            Money from a swap shows as Pending until both sides confirm, then becomes Available.
            Withdraw to your bank anytime. Refunds go straight back to your card.
          </p>
        </div>

        <div id="balance-section">
          <BalanceSection accessToken={session.accessToken} />
        </div>

        <PaymentMethodsSection accessToken={session.accessToken} />

        <PayoutSetupSection accessToken={session.accessToken} />

        <div id="withdrawal-form">
          <WithdrawalForm accessToken={session.accessToken} />
        </div>

        <WithdrawalHistory accessToken={session.accessToken} />
      </section>

      <AddressBookSection accessToken={session.accessToken} />

      {ratings && ratings.total > 0 && (
        <div className="rounded-card border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Recent ratings</h2>
          <div className="mt-3 flex flex-col gap-3">
            {ratings.ratings.slice(0, 5).map((r) => (
              <div key={r.id} className="rounded-btn bg-surface-2 p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-muted">
                  <span className="font-semibold text-foreground">{r.rater.name}</span>
                  <StarRating score={r.score} />
                </p>
                {r.comment && <p className="mt-1 text-muted">&ldquo;{r.comment}&rdquo;</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {user.admin && (
        <Link href="/admin" className="rounded-card border border-rose-500/40 bg-rose-950 p-4 text-sm font-semibold text-rose-200 transition-colors hover:bg-rose-900">
          Admin dashboard →
        </Link>
      )}
    </main>
  );
}
