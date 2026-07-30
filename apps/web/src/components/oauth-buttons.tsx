'use client';

import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';

interface Providers {
  google: boolean;
}

/**
 * Federated sign-in buttons.
 *
 * Rendered only for providers the server reports as configured. A social button
 * that dead-ends because the deployment has no client credentials is worse than
 * no button at all, so the UI asks first rather than assuming.
 *
 * These are plain links, not fetch calls: OAuth begins with a full-page
 * navigation to the provider, which XHR cannot perform.
 */
export function OAuthButtons({ role, intent }: { role?: 'FREELANCER' | 'CLIENT'; intent: 'login' | 'signup' }) {
  const { data, isLoading } = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: async (): Promise<Providers> => {
      const res = await fetch(`${API_BASE}/api/auth/oauth/providers`);
      if (!res.ok) return { google: false };
      return res.json();
    },
    // Server config doesn't change between page views.
    staleTime: 5 * 60_000,
  });

  // Render nothing while unknown, so the form doesn't jump as buttons appear.
  if (isLoading || !data?.google) return null;

  const verb = intent === 'signup' ? 'Sign up' : 'Continue';

  return (
    <div className="flex flex-col gap-4">
      <a
        href={`${API_BASE}/api/auth/oauth/google/start${role ? `?role=${role}` : ''}`}
        className="btn-ghost w-full"
      >
        <GoogleGlyph />
        {verb} with Google
      </a>

      <div className="flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-sm text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

/** Google's four-colour mark. */
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.2 15.5 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-3 .7-4.3v-5.7H4.5C2.9 17.2 2 20.5 2 24s.9 6.8 2.5 10l7.3-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.5 2 8.1 6.8 4.5 14l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"
      />
    </svg>
  );
}

/** Human-readable text for the ?oauth_error= values the callback can redirect with. */
export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    cancelled: 'Google sign-in was cancelled.',
    missing_code: 'Google didn’t complete the sign-in. Please try again.',
    provider_not_configured: 'Google sign-in isn’t enabled on this server.',
    bad_request: 'That sign-in link expired. Please try again.',
  };
  return map[code] ?? 'Google sign-in failed. Please try again.';
}
