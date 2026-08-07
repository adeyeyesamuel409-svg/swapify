import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/auth";
import { fetchMe, fetchUserRatings } from "@/lib/api";

export const metadata = { title: "My Profile - Swapify" };

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session.accessToken) {
    redirect("/api/auth/signin");
  }

  const { user } = await fetchMe(session.accessToken);
  const ratings = await fetchUserRatings(user.id).catch(() => null);
  const tokens = user.wallet ? Number(user.wallet.balanceMicroTokens) / 1_000_000 : 0;

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-bold text-white">My profile</h1>

      <div className="rounded-xl border border-gray-700 bg-gray-800 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-white">{user.name}</p>
            <p className="text-sm text-gray-300">{user.email}</p>
          </div>
          {ratings && ratings.total > 0 && (
            <div className="text-right">
              <p className="text-2xl font-bold text-amber-400">
                {"★".repeat(Math.round(ratings.averageScore ?? 0))}
                <span className="text-gray-600">{"★".repeat(5 - Math.round(ratings.averageScore ?? 0))}</span>
              </p>
              <p className="text-xs text-gray-500">
                {ratings.averageScore?.toFixed(1)} · {ratings.total} rating{ratings.total === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </div>
        {user.bio && <p className="mt-2 text-sm text-gray-400">{user.bio}</p>}
      </div>

      <div className="rounded-xl border border-indigo-500/30 bg-indigo-950 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-indigo-300">Token balance</p>
            <p className="mt-1 text-3xl font-bold text-white">{tokens.toLocaleString()} tokens</p>
            <p className="mt-1 text-xs text-indigo-400">
              Earned by swapping, or bought later. Used to balance value gaps.
            </p>
          </div>
          <a
            href="/wallet"
            className="rounded-md border border-indigo-500 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-900"
          >
            View history
          </a>
        </div>
      </div>

      {ratings && ratings.total > 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-6">
          <h2 className="text-sm font-semibold text-white">Recent ratings</h2>
          <div className="mt-3 flex flex-col gap-3">
            {ratings.ratings.slice(0, 5).map((r) => (
              <div key={r.id} className="rounded-lg bg-gray-900 p-3 text-sm">
                <p className="text-gray-300">
                  <span className="font-semibold text-white">{r.rater.name}</span>{" "}
                  {"★".repeat(r.score)}
                  <span className="text-gray-600">{"★".repeat(5 - r.score)}</span>
                </p>
                {r.comment && <p className="mt-1 text-gray-400">&ldquo;{r.comment}&rdquo;</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {user.admin && (
        <Link href="/admin" className="rounded-xl border border-red-500/40 bg-red-950 p-4 text-sm font-semibold text-red-200 hover:bg-red-900">
          Admin dashboard →
        </Link>
      )}
    </main>
  );
}
