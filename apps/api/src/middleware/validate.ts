import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { ApiError } from '../lib/api-error.js';

/**
 * Validates and *replaces* req.body with the parsed result.
 *
 * Replacing rather than merely checking is the point: downstream handlers then
 * work with coerced, stripped data, so an attacker can't smuggle extra fields
 * (`role: "ADMIN"`, `trustScore: 999`) through into a Prisma call.
 *
 * The sprint plan schedules validation for Day 26. Doing it at the boundary
 * from the start is strictly less work than retrofitting it across a finished
 * API — see the README "Deviations" section.
 */
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const { fieldErrors, formErrors } = result.error.flatten();
      // Whole-object problems (notably .strict()'s unrecognized-keys error)
      // land in formErrors, not fieldErrors. Without this the client gets
      // "validation failed" with an empty details object and no way to tell
      // which key was rejected.
      const details: Record<string, string[]> = { ...(fieldErrors as Record<string, string[]>) };
      if (formErrors.length) details._ = formErrors;

      next(
        ApiError.badRequest(formErrors[0] ?? 'Request validation failed', details),
      );
      return;
    }
    req.body = result.data as z.infer<T>;
    next();
  };
}

export function validateParams<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(
        ApiError.badRequest('Invalid URL parameters', result.error.flatten().fieldErrors as Record<string, string[]>),
      );
      return;
    }
    Object.assign(req.params, result.data);
    next();
  };
}
