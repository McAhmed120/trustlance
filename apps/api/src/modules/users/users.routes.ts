import path from 'node:path';
import { Router } from 'express';
import type { PublicUserDto, Role } from '@trustlance/shared-types';
import { avatarUpload, avatarUrlFor, deleteAvatarFile } from './avatar.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { toMeDto, userSelect } from '../auth/auth.service.js';
import { updateProfileSchema, userIdParamSchema } from './users.schemas.js';

export const usersRouter: Router = Router();

/** GET /api/users/me */
usersRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: userSelect });
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  res.json(toMeDto(user));
});

/**
 * PATCH /api/users/me
 *
 * Updates only the profile. Role, email, emailVerified and trustScore are
 * deliberately not editable here — trustScore in particular is computed from
 * completed work (§10.3), and a self-editable trust score would make the whole
 * reputation system meaningless.
 */
usersRouter.patch('/me', requireAuth, validateBody(updateProfileSchema), async (req, res) => {
  const data = req.body as Record<string, unknown>;

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      profile: {
        // upsert, not update: an account could exist without a profile row if a
        // future migration or admin action ever creates one directly.
        upsert: {
          create: { displayName: 'New user', ...data },
          update: data,
        },
      },
    },
    select: userSelect,
  });

  res.json(toMeDto(user));
});

/**
 * POST /api/users/me/avatar — multipart upload, field name "file".
 *
 * Replaces any existing avatar and deletes the superseded file, so a user who
 * changes their picture ten times doesn't leave ten orphans on disk.
 */
usersRouter.post('/me/avatar', requireAuth, avatarUpload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw ApiError.badRequest('No file provided (field name: "file")');

  const existing = await prisma.profile.findUnique({
    where: { userId: req.user!.id },
    select: { avatarPath: true },
  });

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      profile: {
        upsert: {
          create: { displayName: 'New user', avatarPath: file.path },
          update: { avatarPath: file.path },
        },
      },
    },
    select: userSelect,
  });

  deleteAvatarFile(existing?.avatarPath ?? null);
  res.status(201).json(toMeDto(user));
});

/** DELETE /api/users/me/avatar — revert to initials. */
usersRouter.delete('/me/avatar', requireAuth, async (req, res) => {
  const existing = await prisma.profile.findUnique({
    where: { userId: req.user!.id },
    select: { avatarPath: true },
  });

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { profile: { update: { avatarPath: null } } },
    select: userSelect,
  });

  deleteAvatarFile(existing?.avatarPath ?? null);
  res.json(toMeDto(user));
});

/**
 * GET /api/users/:userId/avatar — public image.
 *
 * Unauthenticated on purpose: avatars appear on public trust profiles and in
 * job listings, which anyone can read.
 */
usersRouter.get('/:userId/avatar', validateParams(userIdParamSchema), async (req, res) => {
  const { userId } = req.params as { userId: string };
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { avatarPath: true },
  });
  if (!profile?.avatarPath) throw ApiError.notFound('No avatar set');

  // Immutable: the URL carries a version parameter, so a cached copy can never
  // be the wrong image.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.resolve(profile.avatarPath), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Avatar file missing' } });
  });
});

/**
 * GET /api/users/:userId — public trust profile (§5).
 *
 * Returns PublicUserDto, which omits email and emailVerified. Building the
 * projection explicitly rather than deleting fields from the full record means
 * a column added later is private by default instead of accidentally exposed.
 */
usersRouter.get('/:userId', validateParams(userIdParamSchema), async (req, res) => {
  // Express 5 types params as string | string[]. validateParams has already
  // proved this is a single uuid string, so narrow it once here rather than
  // letting the union leak into (and degrade) Prisma's type inference.
  const { userId } = req.params as { userId: string };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      trustScore: true,
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
    },
  });

  if (!user) throw ApiError.notFound('User not found');

  const body: PublicUserDto = {
    id: user.id,
    role: user.role as Role,
    createdAt: user.createdAt.toISOString(),
    trustScore: user.trustScore,
    // Rebuild the profile explicitly: avatarPath is an internal filesystem
    // path and must never leave the server, so it is swapped for a URL.
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
  res.json(body);
});
