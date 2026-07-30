import { z } from 'zod';

/**
 * Password policy: length over composition rules.
 *
 * A 12-char minimum with no forced symbol/digit mix is what current NIST
 * guidance recommends — composition rules push users toward predictable
 * patterns like "Password1!" without adding real entropy.
 */
const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password must be at most 200 characters');

export const registerSchema = z.object({
  email: z.string().email('Must be a valid email address').max(254).toLowerCase().trim(),
  password: passwordSchema,
  // ADMIN is deliberately not accepted here. Arbitrators are provisioned out of
  // band; letting anyone self-register as ADMIN would hand them the dispute
  // resolution powers from Sprint 5.
  role: z.enum(['FREELANCER', 'CLIENT']),
  displayName: z.string().min(2, 'Display name must be at least 2 characters').max(80).trim(),
});

export const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
