import type { ApiErrorResponse, AuthResponse } from '@trustlance/shared-types';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Marks a request as coming from this app.
 *
 * Sent on every cookie-authenticated call. When the deployment runs split hosts
 * the refresh cookie has to be SameSite=None, and this header is what closes the
 * CSRF hole that opens: a custom header forces a CORS preflight, which a foreign
 * origin cannot pass. Harmless when SameSite is Strict.
 */
const CLIENT_HEADER = { 'x-trustlance-client': '1' } as const;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;
  /**
   * Seconds until a rate-limited request may be retried, from the server's
   * Retry-After header. Lets the UI count down and re-enable itself instead of
   * telling the user to "try again later" with no idea when later is.
   */
  readonly retryAfter?: number;

  constructor(status: number, body: ApiErrorResponse['error'], retryAfter?: number) {
    super(body.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.retryAfter = retryAfter;
  }

  /** First validation message for a field, for inline form errors. */
  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

/*
 * The access token lives in a module-level variable — deliberately not
 * localStorage or sessionStorage.
 *
 * Anything readable by JavaScript is readable by injected JavaScript, so a
 * single XSS would hand an attacker a token. In memory, the blast radius of
 * XSS is the current tab's lifetime; the refresh token that could mint new
 * access tokens is httpOnly and unreachable from here.
 *
 * Cost: a page reload loses the token. bootstrapSession() below trades one
 * refresh call on mount for that safety.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/*
 * Single-flight refresh.
 *
 * If three requests 401 at once, three parallel /refresh calls would rotate the
 * token three times — and because rotation revokes the previous token, two of
 * them would look like token *reuse* and burn the whole family, logging the
 * user out. Sharing one in-flight promise is what makes rotation and
 * concurrency coexist.
 */
let refreshInFlight: Promise<boolean> | null = null;
/** Last successful refresh payload, so bootstrapSession can reuse this call. */
let lastRefreshResponse: AuthResponse | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...CLIENT_HEADER },
      });
      if (!res.ok) {
        setAccessToken(null);
        lastRefreshResponse = null;
        return false;
      }
      const data = (await res.json()) as AuthResponse;
      setAccessToken(data.accessToken);
      lastRefreshResponse = data;
      return true;
    } catch {
      setAccessToken(null);
      lastRefreshResponse = null;
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Internal: prevents infinite retry loops. */
  _isRetry?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, _isRetry, headers, ...rest } = options;

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    // Always send cookies: the refresh token rides along on /api/auth calls.
    credentials: 'include',
    headers: {
      ...CLIENT_HEADER,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  // Expired access token — refresh once, then replay the original request.
  if (res.status === 401 && !_isRetry && !path.startsWith('/api/auth/refresh')) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest<T>(path, { ...options, _isRetry: true });
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (payload as ApiErrorResponse | null)?.error;
    const retryAfter = Number(res.headers.get('Retry-After'));
    throw new ApiClientError(
      res.status,
      err ?? { code: 'UNKNOWN', message: res.statusText },
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }

  return payload as T;
}

/**
 * Restores a session on page load.
 *
 * The access token is gone after a reload (it only ever lived in memory), but
 * the httpOnly refresh cookie survives — so one refresh call silently rebuilds
 * the session instead of bouncing the user to the login page.
 */
export async function bootstrapSession(): Promise<AuthResponse | null> {
  // Must share refreshSession's single-flight promise, not open its own call.
  // Bootstrapping on mount while a query 401s would otherwise fire two
  // concurrent refreshes with the SAME token — which the server treats as a
  // rotation race (write conflict) and, worse, could read as token reuse and
  // revoke the whole family. Bug found by the browser tour, not by unit tests.
  const okRefresh = await refreshSession();
  if (!okRefresh) return null;
  return lastRefreshResponse;
}
