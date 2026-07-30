import { Router } from 'express';
import type { NotificationDto } from '@trustlance/shared-types';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/require-auth.js';

export const notificationsRouter: Router = Router();

/** GET /api/notifications — latest 30, unread first. */
notificationsRouter.get('/', requireAuth, async (req, res) => {
  const rows = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
    take: 30,
  });
  const body: NotificationDto[] = rows.map((n) => ({
    id: n.id,
    type: n.type,
    payload: n.payload as { title: string; link?: string },
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));
  res.json(body);
});

/** POST /api/notifications/read-all */
notificationsRouter.post('/read-all', requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).send();
});
