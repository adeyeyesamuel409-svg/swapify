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
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/wallet")}`);
  }

  let wallet: Awaited<ReturnType<typeof fetchWallet>>["wallet"] | null = null;
  let transactions: Awaited<ReturnType<typeof fetchWallet>>["transactions"] = [];
  let loadError = "";
  try {
    const result = await fetchWallet(session.accessToken);
    wallet = result.wallet;
    transactions = result.transactions;
  } catch {
    loadError = "We couldn't load your wallet right now.";
  }
  const balance = wallet ? Number(BigInt(wallet.balanceMicroTokens)) / 1_000_000 : 0;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">My wallet</h1>
        <Link href="/post" className="rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110">
          Post an item
        </Link>
      </div>

      <div className="mt-6 rounded-card border border-token/30 bg-token/10 p-6">
        <p className="text-sm font-medium text-token">Balance</p>
        <p className="mt-1 text-4xl font-bold text-token">{balance.toLocaleString()} tokens</p>
        <p className="mt-2 text-xs text-muted">
          Tokens balance value differences when swapping. Buy them or earn them by swapping.
        </p>
      </div>

      {loadError ? (
        <div className="mt-10 rounded-card border border-rose-500/40 bg-rose-950/30 p-8 text-center">
          <p className="text-foreground">{loadError}</p>
          <p className="mt-1 text-sm text-muted">Please try again in a moment.</p>
        </div>
      ) : (
        <>
          <h2 className="mt-10 text-xl font-semibold text-foreground">Transaction history</h2>

          {transactions.length === 0 ? (
            <p className="mt-4 text-muted">No transactions yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
              {transactions.map((t) => {
                const amount = Number(BigInt(t.amountMicroTokens)) / 1_000_000;
                const credit = t.direction === "CREDIT";
                return (
                  <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="font-medium text-foreground">{TYPE_LABELS[t.type] ?? t.type}</p>
                      <p className="text-xs text-muted">
                        {new Date(t.createdAt).toLocaleString()}
                        {t.note ? ` · ${t.note}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${credit ? "text-emerald-400" : "text-rose-400"}`}>
                        {credit ? "+" : "-"}
                        {amount.toLocaleString()} tokens
                      </p>
                      <p className="text-xs text-muted">
                        Balance after: {Number(BigInt(t.balanceAfterMicroTokens)) / 1_000_000}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
