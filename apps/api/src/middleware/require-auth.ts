import type { RequestHandler } from 'express';
import type { Role } from '@trustlance/shared-types';
import { ApiError } from '../lib/api-error.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

/**
 * Rejects the request unless a valid access token is present.
 *
 * Reads only the Authorization header, never the refresh cookie: the refresh
 * cookie is scoped to /api/auth and must not be usable to authorise ordinary
 * API calls.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(ApiError.unauthorized('Missing Bearer token'));
    return;
  }

  const { sub, role } = verifyAccessToken(header.slice('Bearer '.length));
  req.user = { id: sub, role };
  next();
};

/**
 * Restricts a route to the given roles. Compose after requireAuth.
 *
 *   router.post('/disputes/:id/resolve', requireAuth, requireRole('ADMIN'), handler)
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden(`Requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}
