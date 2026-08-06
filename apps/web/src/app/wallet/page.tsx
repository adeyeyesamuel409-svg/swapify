import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/auth";
import { fetchWallet } from "@/lib/api";

export const metadata = { title: "My Wallet - Swapify" };

const TYPE_LABELS: Record<string, string> = {
  SWAP_GAP: "Swap gap payment",
  PURCHASE: "Token purchase",
  EARN: "Earned",
  ESCROW_HOLD: "Escrow hold",
  ESCROW_RELEASE: "Escrow released",
  ESCROW_REFUND: "Escrow refund",
  ADJUSTMENT: "Adjustment",
};

export default async function WalletPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session.accessToken) {
    redirect("/api/auth/signin");
  }

  const { wallet, transactions } = await fetchWallet(session.accessToken);
  const balance = Number(BigInt(wallet.balanceMicroTokens)) / 1_000_000;

  return (
    <main className="mx-auto max-w-3xl flex-1 px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">My wallet</h1>
        <Link href="/post" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
          Post an item
        </Link>
      </div>

      <div className="mt-6 rounded-xl border border-indigo-500/30 bg-indigo-950 p-6">
        <p className="text-sm font-medium text-indigo-300">Balance</p>
        <p className="mt-1 text-4xl font-bold text-white">{balance.toLocaleString()} tokens</p>
        <p className="mt-2 text-xs text-indigo-400">
          Tokens balance value differences when swapping. Buy them (coming in Sprint 6) or earn them by swapping.
        </p>
      </div>

      <h2 className="mt-10 text-xl font-semibold text-white">Transaction history</h2>

      {transactions.length === 0 ? (
        <p className="mt-4 text-gray-400">No transactions yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-700 rounded-xl border border-gray-700 bg-gray-800">
          {transactions.map((t) => {
            const amount = Number(BigInt(t.amountMicroTokens)) / 1_000_000;
            const credit = t.direction === "CREDIT";
            return (
              <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-medium text-white">{TYPE_LABELS[t.type] ?? t.type}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(t.createdAt).toLocaleString()}
                    {t.note ? ` · ${t.note}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold ${credit ? "text-emerald-400" : "text-red-400"}`}>
                    {credit ? "+" : "-"}
                    {amount.toLocaleString()} tokens
                  </p>
                  <p className="text-xs text-gray-500">
                    Balance after: {Number(BigInt(t.balanceAfterMicroTokens)) / 1_000_000}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
