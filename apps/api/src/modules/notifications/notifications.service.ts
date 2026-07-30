import { prisma } from '../../lib/prisma.js';
import { emitToUser } from '../../realtime/socket.js';

/**
 * Creates an in-app notification and pushes it live over the socket.
 *
 * Persist first, push second: the socket push is best-effort (the user may be
 * offline), the row is the durable record they'll see on next load.
 */
export async function notify(
  userId: string,
  type: string,
  payload: { title: string; link?: string },
): Promise<void> {
  const row = await prisma.notification.create({
    data: { userId, type, payload },
    select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
  });
  emitToUser(userId, 'notification', {
    id: row.id,
    type: row.type,
    payload: row.payload,
    readAt: null,
    createdAt: row.createdAt.toISOString(),
  });
}
