import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { ApiError } from '../../lib/api-error.js';

/**
 * Avatar upload plumbing.
 *
 * Files live on disk under uploads/avatars and the row stores only the path.
 * Images in Postgres bloat every backup and every query that selects the row.
 */
export const AVATAR_ROOT = path.resolve(process.cwd(), 'uploads', 'avatars');

/** Raster images only — no SVG, which can carry script and would execute if ever served inline. */
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(AVATAR_ROOT, { recursive: true });
      cb(null, AVATAR_ROOT);
    },
    // Random stored name: the original filename is attacker-controlled input
    // and must never influence a filesystem path.
    filename: (_req, file, cb) => {
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[
        file.mimetype
      ];
      cb(null, `${crypto.randomUUID()}${ext ?? ''}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new ApiError(400, 'BAD_FILE_TYPE', 'Avatar must be a PNG, JPEG, WebP or GIF image'));
  },
});

/**
 * Builds the public URL for a profile's avatar.
 *
 * The `v` parameter is the profile's updatedAt epoch: without it a replaced
 * avatar keeps showing the browser's cached copy of the old image, since the
 * URL is otherwise identical.
 */
export function avatarUrlFor(
  userId: string,
  profile: { avatarPath: string | null; updatedAt: Date } | null,
): string | null {
  if (!profile?.avatarPath) return null;
  return `/api/users/${userId}/avatar?v=${profile.updatedAt.getTime()}`;
}

/** Best-effort removal of a superseded avatar file. */
export function deleteAvatarFile(avatarPath: string | null): void {
  if (!avatarPath) return;
  // Refuse anything that escapes the avatar directory, even though these paths
  // are server-generated — a traversal here would delete arbitrary files.
  const resolved = path.resolve(avatarPath);
  if (!resolved.startsWith(AVATAR_ROOT)) return;
  fs.promises.unlink(resolved).catch(() => {
    /* already gone — nothing to do */
  });
}
