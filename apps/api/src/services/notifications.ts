import { NotificationType, prisma } from '@swapify/db';
import pino from 'pino';

const log = pino({ name: 'notifications', level: process.env.LOG_LEVEL ?? 'info' });

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
  } catch (err) {
    // Swallow: a notification failing should never break the request, but log
    // for observability so silent failures are not invisible.
    log.warn({ err, userId, type }, 'Failed to create notification');
  }
}

export { NotificationType };
