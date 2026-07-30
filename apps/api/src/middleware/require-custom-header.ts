import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';

/** The header the web client attaches to cookie-authenticated state changes. */
export const CSRF_HEADER = 'x-trustlance-client';

/**
 * Cheap CSRF defence for cookie-authenticated POSTs, active only when the
 * refresh cookie is SameSite=None.
 *
 * With SameSite=Strict the browser already refuses to attach the cookie to a
 * cross-site request, so nothing more is needed. Split-host deployments have to
 * relax that to None, which re-opens a narrow hole: a foreign page can still
 * *send* a POST to /api/auth/refresh with the cookie attached. It cannot read
 * the response (CORS blocks that), but the rotation still happens — and because
 * rotation revokes the previous token, the victim's next refresh looks like
 * token reuse and burns their whole session. A logout-anyone CSRF.
 *
 * Requiring a custom header closes it: a custom header makes the request
 * non-simple, so the browser must preflight it, and the preflight fails for any
 * origin not in the CORS allow-list. No token, no shared secret, no state.
 */
export const requireCustomHeader: RequestHandler = (req, _res, next) => {
  if (env.COOKIE_SAMESITE !== 'none') {
    next();
    return;
  }

  if (req.get(CSRF_HEADER)) {
    next();
    return;
  }

  next(
    new ApiError(
      403,
      'MISSING_CLIENT_HEADER',
      `This endpoint requires the ${CSRF_HEADER} header`,
    ),
  );
};
