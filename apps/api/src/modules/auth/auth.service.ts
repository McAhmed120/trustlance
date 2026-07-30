import bcrypt from 'bcryptjs';
import type { MeDto, Role } from '@trustlance/shared-types';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import { avatarUrlFor } from '../users/avatar.js';

/**
 * A bcrypt hash of a throwaway value, used to equalise timing on the
 * unknown-email login path (see verifyCredentials).
 */
const DUMMY_HASH = bcrypt.hashSync('trustlance_dummy_password_value', env.BCRYPT_COST);

type UserWithProfile = {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
  createdAt: Date;
  profile: {
    displayName: string;
    bio: string | null;
    skills: string[];
    hourlyRateCents: number | null;
    portfolioLinks: string[];
    avatarPath: string | null;
    updatedAt: Date;
  } | null;
};

/** Shapes a user row for the client. Never includes passwordHash. */
export function toMeDto(user: UserWithProfile): MeDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
    profile: user.profile
      ? {
          displayName: user.profile.displayName,
          avatarUrl: avatarUrlFor(user.id, user.profile),
          bio: user.profile.bio,
          skills: user.profile.skills,
          hourlyRateCents: user.profile.hourlyRateCents,
          portfolioLinks: user.profile.portfolioLinks,
        }
      : null,
  };
}

export const userSelect = {
  id: true,
  email: true,
  role: true,
  emailVerified: true,
  createdAt: true,
  profile: {
    select: {
      displayName: true,
      bio: true,
      skills: true,
      hourlyRateCents: true,
      portfolioLinks: true,
      avatarPath: true,
      updatedAt: true,
    },
  },
} as const;

export async function registerUser(input: RegisterInput): Promise<MeDto> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    // Registration necessarily leaks whether an email is taken — there is no
    // way to create a unique account without it. Login does not leak this.
    throw ApiError.conflict('An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);

  // User and profile in one transaction: a user without a profile would break
  // every screen that renders a display name.
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: input.role,
      profile: { create: { displayName: input.displayName } },
    },
    select: userSelect,
  });

  return toMeDto(user);
}

/**
 * Verifies credentials.
 *
 * Always runs a bcrypt comparison, even when the email is unknown. Returning
 * early would make "no such user" measurably faster than "wrong password",
 * turning login into an account-enumeration oracle — which would undermine the
 * Day 19 sybil work by letting an attacker map the user base.
 */
export async function verifyCredentials(input: LoginInput): Promise<MeDto> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...userSelect, passwordHash: true },
  });

  /*
   * OAuth-only accounts have a null passwordHash. Comparing against the dummy
   * hash keeps the timing identical to an unknown email AND guarantees the
   * comparison fails — a null hash must never be treated as "matches anything".
   *
   * The error stays the generic one rather than "this account uses Google":
   * a distinct message would turn login into an oracle for which addresses are
   * registered and how. The login page carries a static hint instead.
   */
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.passwordHash || !ok) {
    throw ApiError.unauthorized('Incorrect email or password');
  }

  const { passwordHash: _passwordHash, ...rest } = user;
  return toMeDto(rest);
}

export async function getUserById(id: string): Promise<MeDto | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
  return user ? toMeDto(user) : null;
}
