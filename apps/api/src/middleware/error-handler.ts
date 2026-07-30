import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { env } from '../config/env.js';

/** Terminal 404 handler — mounted after every route. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
};

/**
 * Single place where an error becomes an HTTP response.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route code can `throw ApiError.notFound(...)` and stop threading errors
 * through next() by hand.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
    return;
  }

  // A Zod error reaching here means a schema ran outside the validate()
  // middleware. Still report it usefully rather than as an opaque 500.
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten().fieldErrors as Record<string, string[]>,
      },
    });
    return;
  }

  // Unexpected: a bug. Log everything, tell the client nothing.
  console.error('[unhandled]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction ? 'Something went wrong' : String((err as Error)?.message ?? err),
    },
  });
};
