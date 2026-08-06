import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { fetchMe } from "@/lib/api";

export const metadata = { title: "My Profile - Swapify" };

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session.accessToken) {
    redirect("/api/auth/signin");
  }

  const { user } = await fetchMe(session.accessToken);
  const tokens = user.wallet ? Number(user.wallet.balanceMicroTokens) / 1_000_000 : 0;

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-bold text-white">My profile</h1>

      <div className="rounded-xl border border-gray-700 bg-gray-800 p-6">
        <p className="text-lg font-semibold text-white">{user.name}</p>
        <p className="text-sm text-gray-300">{user.email}</p>
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
    </main>
  );
}
