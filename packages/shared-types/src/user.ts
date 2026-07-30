/** Account roles (documentation §4 personas). */
export const ROLES = ['FREELANCER', 'CLIENT', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The authenticated user's own view of their account.
 * Never includes passwordHash.
 */
export interface MeDto {
  id: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  createdAt: string;
  profile: ProfileDto | null;
}

/**
 * Public projection of a user — what anyone can see on a trust profile.
 * Deliberately omits email: exposing it would make the Day 19 sybil work
 * pointless, since scrapers could enumerate the user base.
 */
export interface PublicUserDto {
  id: string;
  role: Role;
  createdAt: string;
  /** Computed in Sprint 4 Day 18. Null until then. */
  trustScore: number | null;
  profile: ProfileDto | null;
}

export interface ProfileDto {
  displayName: string;
  /**
   * Absolute-path URL of the user's avatar, or null to render initials.
   * Carries a cache-busting version so a freshly uploaded image replaces the
   * old one immediately instead of showing a stale browser cache.
   */
  avatarUrl: string | null;
  bio: string | null;
  skills: string[];
  /**
   * Integer cents, never a float (§11). Every monetary value in TrustLance
   * follows this convention — see escrow amounts in Sprint 3.
   */
  hourlyRateCents: number | null;
  portfolioLinks: string[];
}

export interface UpdateProfileDto {
  displayName?: string;
  bio?: string | null;
  skills?: string[];
  hourlyRateCents?: number | null;
  portfolioLinks?: string[];
}
