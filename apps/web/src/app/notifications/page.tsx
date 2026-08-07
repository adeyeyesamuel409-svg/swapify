import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { fetchNotifications } from "@/lib/api";
import NotificationsClient from "@/components/NotificationsClient";

export const metadata = { title: "Notifications - Swapify" };

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) redirect("/api/auth/signin");

  const { notifications } = await fetchNotifications(session.accessToken);

  return <NotificationsClient initial={notifications} accessToken={session.accessToken} />;
}
