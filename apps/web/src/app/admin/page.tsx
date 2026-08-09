import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { fetchAdminListings, fetchAdminStats, fetchAdminUsers, fetchMe } from "@/lib/api";
import AdminActions from "@/components/AdminActions";

export const metadata = { title: "Admin - Swapify" };

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/admin")}`);

  const me = await fetchMe(session.accessToken).catch(() => null);
  if (!me?.user.admin) redirect("/");

  const adminData = await Promise.all([
    fetchAdminStats(session.accessToken).catch(() => null),
    fetchAdminUsers(session.accessToken).catch(() => null),
    fetchAdminListings(session.accessToken).catch(() => null),
  ]);

  const stats = adminData[0]?.stats ?? null;
  const users = adminData[1]?.users ?? [];
  const items = adminData[2]?.items ?? [];

  if (!stats) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 text-center sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Admin dashboard</h1>
        <p className="mt-3 text-muted">We couldn&apos;t load admin data right now. Please try again in a moment.</p>
      </main>
    );
  }

  const escrowTokens = Number(BigInt(stats.escrowedMicroTokens)) / 1_000_000;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Admin dashboard</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {me.user.admin?.role}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Users", value: stats.users },
          { label: "Listings", value: stats.items },
          { label: "Swaps", value: stats.swaps },
          { label: "Active swaps", value: stats.activeSwaps },
          { label: "Tokens in escrow", value: escrowTokens.toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="rounded-card border border-line bg-surface p-5 shadow-card">
            <p className="text-sm text-muted">{s.label}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      <AdminActions accessToken={session.accessToken} users={users} items={items} />
    </main>
  );
}
