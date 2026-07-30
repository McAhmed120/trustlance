import { z } from 'zod';

export const updateProfileSchema = z
  .object({
    displayName: z.string().min(2).max(80).trim().optional(),
    bio: z.string().max(2000).trim().nullable().optional(),
    skills: z.array(z.string().min(1).max(40).trim()).max(30).optional(),
    /**
     * Integer cents (§11). Rejecting floats at the boundary is what keeps the
     * "never store money as a float" rule true — a 49.99 arriving here would
     * otherwise be silently coerced somewhere downstream.
     */
    hourlyRateCents: z
      .number()
      .int('Hourly rate must be an integer number of cents')
      .min(0)
      .max(100_000_00, 'Hourly rate must be at most $100,000')
      .nullable()
      .optional(),
    portfolioLinks: z.array(z.string().url('Portfolio links must be valid URLs')).max(10).optional(),
  })
  .strict(); // reject unknown keys outright rather than silently dropping them

export const userIdParamSchema = z.object({
  userId: z.string().uuid('Must be a valid user id'),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
