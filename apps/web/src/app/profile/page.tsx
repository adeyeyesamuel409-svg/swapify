import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/auth";
import { fetchMe, fetchUserRatings } from "@/lib/api";

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
  const tokens = user.wallet ? Number(user.wallet.balanceMicroTokens) / 1_000_000 : 0;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">My profile</h1>

      <div className="rounded-card border border-line bg-surface p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-foreground">{user.name}</p>
            <p className="text-sm text-muted">{user.email}</p>
          </div>
          {ratings && ratings.total > 0 && (
            <div className="text-right">
              <p className="text-2xl font-bold text-token">
                {"★".repeat(Math.round(ratings.averageScore ?? 0))}
                <span className="text-line-strong">{"★".repeat(5 - Math.round(ratings.averageScore ?? 0))}</span>
              </p>
              <p className="text-xs text-muted">
                {ratings.averageScore?.toFixed(1)} · {ratings.total} rating{ratings.total === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </div>
        {user.bio && <p className="mt-2 text-sm text-muted">{user.bio}</p>}
      </div>

      <div className="rounded-card border border-token/30 bg-token/10 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-token">Token balance</p>
            <p className="mt-1 text-3xl font-bold text-token">{tokens.toLocaleString()} tokens</p>
            <p className="mt-1 text-xs text-muted">
              Earned by swapping, or bought. Used to balance value gaps.
            </p>
          </div>
          <a
            href="/wallet"
            className="rounded-btn border border-token/40 px-4 py-2 text-sm font-semibold text-token transition-colors hover:bg-token/15"
          >
            View history
          </a>
        </div>
      </div>

      {ratings && ratings.total > 0 && (
        <div className="rounded-card border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Recent ratings</h2>
          <div className="mt-3 flex flex-col gap-3">
            {ratings.ratings.slice(0, 5).map((r) => (
              <div key={r.id} className="rounded-btn bg-surface-2 p-3 text-sm">
                <p className="text-muted">
                  <span className="font-semibold text-foreground">{r.rater.name}</span>{" "}
                  {"★".repeat(r.score)}
                  <span className="text-line-strong">{"★".repeat(5 - r.score)}</span>
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
