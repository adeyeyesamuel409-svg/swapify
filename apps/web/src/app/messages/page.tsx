import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { fetchMe, fetchMyInquiries } from "@/lib/api";
import InboxClient from "@/components/InboxClient";

export const metadata = { title: "Messages - Swapify" };

export default async function MessagesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/messages")}`);
  }

  let userId = (session.user as { id?: string }).id ?? "";
  if (!userId) {
    try {
      ({ user: { id: userId } } = await fetchMe(session.accessToken));
    } catch {
      userId = "";
    }
  }

  const { inquiries } = await fetchMyInquiries(session.accessToken).catch(() => ({ inquiries: [] }));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-navy">Messages</h1>
      <p className="mt-1 text-sm text-muted">
        Questions about items and the conversations around them.
      </p>
      <InboxClient threads={inquiries} accessToken={session.accessToken} myUserId={userId} />
    </main>
  );
}
