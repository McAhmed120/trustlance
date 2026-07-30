import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { jobsRouter } from './modules/jobs/jobs.routes.js';
import { proposalsRouter } from './modules/proposals/proposals.routes.js';
import { contractsRouter } from './modules/contracts/contracts.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { walletRouter, milestonesRouter, disputesRouter } from './modules/escrow/escrow.routes.js';
import { reputationRouter } from './modules/reputation/reputation.routes.js';
import { workspaceRouter } from './modules/workspace/workspace.routes.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { requireAuth, requireRole } from './middleware/require-auth.js';
import { openApiDocument } from './docs/openapi.js';
import swaggerUi from 'swagger-ui-express';

/**
 * Builds the Express app without starting a listener.
 *
 * Kept separate from server.ts so Supertest (Day 5) can drive the app
 * in-process instead of binding a real port per test file.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Trust the first proxy hop so req.ip is the real client address behind
  // Railway/Render — signup rate limiting by IP (Day 19) depends on this.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON and the Swagger UI, never the app's own HTML, so a
      // restrictive CSP here would only break /api/docs without protecting
      // anything. The web app's CSP is Vercel's concern.
      contentSecurityPolicy: false,
      // Downloaded contract files must not be sniffed into something executable.
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      // Required for the refresh-token cookie to travel cross-origin.
      credentials: true,
      // Our own CSRF header must be allow-listed, or the preflight it triggers
      // would reject the legitimate client along with everyone else.
      allowedHeaders: ['Content-Type', 'Authorization', 'x-trustlance-client'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Health is deliberately outside the rate limiter — an uptime probe polling
  // every few seconds must never be throttled into reporting a false outage.
  app.use('/health', healthRouter);

  // Interactive API reference. Not exposed in production — the spec documents
  // the auth surface in detail and there's no reason to publish that.
  if (!env.isProduction) {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument as object));
  }

  app.use('/api', apiRateLimit);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api', proposalsRouter); // mounts /api/jobs/:id/proposals and /api/proposals/*
  app.use('/api/contracts', contractsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/milestones', milestonesRouter);
  app.use('/api/disputes', disputesRouter);
  app.use('/api/reputation', reputationRouter);
  app.use('/api/contracts', workspaceRouter); // /:id/messages, /:id/time, /:id/files

  /*
   * Arbitrator-only probe.
   *
   * Exists so the RBAC guard is exercised by a real route from Sprint 1 rather
   * than first being trusted in Sprint 5, where it gates the dispute-resolution
   * endpoint that can move money.
   */
  app.get('/api/admin/ping', requireAuth, requireRole('ADMIN'), (req, res) => {
    res.json({ ok: true, userId: req.user!.id, role: req.user!.role });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
