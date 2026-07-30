import type { MeDto, Role } from './user.js';

export interface RegisterRequest {
  email: string;
  password: string;
  role: Extract<Role, 'FREELANCER' | 'CLIENT'>;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Login/register/refresh response.
 *
 * Note what is absent: the refresh token. It travels only as an httpOnly
 * cookie so client-side JavaScript can never read it. The access token is
 * returned in the body because it is meant to be held in memory (see the
 * Zustand store) and deliberately not persisted to localStorage.
 */
export interface AuthResponse {
  accessToken: string;
  /** Seconds until accessToken expires. */
  expiresIn: number;
  user: MeDto;
}

/** Decoded access-token claims. */
export interface AccessTokenClaims {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

/** Uniform API error shape. */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    /** Field-level messages, present on validation failures. */
    details?: Record<string, string[]>;
  };
}
