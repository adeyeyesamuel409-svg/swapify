import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { fetchNotifications, type ApiNotification } from "@/lib/api";
import NotificationsClient from "@/components/NotificationsClient";

export const metadata = { title: "Notifications - Swapify" };

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/notifications")}`);

  let notifications: ApiNotification[] = [];
  try {
    ({ notifications } = await fetchNotifications(session.accessToken));
  } catch {
    notifications = [];
  }

  return <NotificationsClient initial={notifications} accessToken={session.accessToken} />;
}
