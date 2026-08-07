import { NotificationType, prisma } from '@swapify/db';

// Creates an in-app notification. Never throws - notifications are best-effort
// side effects and must not fail the primary action.
export async function notify(
  userId: string | undefined,
  type: NotificationType,
  body: string,
  referenceId?: string | null,
): Promise<void> {
  if (!userId) return;
  try {
    await prisma.notification.create({
      data: { userId, type, body, referenceId: referenceId ?? null },
    });
  } catch {
    // Swallow: a notification failing should never break the request.
  }
}

export { NotificationType };
