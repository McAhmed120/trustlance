'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { ApiClientError } from '@/lib/api';
import { Button, Field, FormError } from '@/components/ui';
import { PasswordField } from '@/components/password-field';
import { AuthAside } from '@/components/auth-aside';
import { OAuthButtons, oauthErrorMessage } from '@/components/oauth-buttons';

const LAST_EMAIL_KEY = 'trustlance-last-email';

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const login = useAuthStore((s) => s.login);
  const router = useRouter();
  const params = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  /** Seconds left on a 429 lockout; 0 means not rate limited. */
  const [cooldown, setCooldown] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);

  /*
   * Prefill the last email used on this device — the address only, never the
   * password, which has no business in localStorage.
   *
   * Written straight to the DOM rather than into state: setState here would be
   * a cascading render, and a state-driven defaultValue would differ between
   * the server render (empty) and the client (stored), producing a hydration
   * mismatch on the input's value attribute.
   */
  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_EMAIL_KEY);
      if (last && emailRef.current && !emailRef.current.value) {
        emailRef.current.value = last;
      }
    } catch {
      /* storage disabled — the field just starts empty */
    }
  }, []);

  // Live countdown while rate limited, so the button re-enables itself.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const oauthError = oauthErrorMessage(params.get('oauth_error'));
  const justRegistered = params.get('registered') === '1';
  const sessionExpired = params.get('expired') === '1';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (cooldown > 0) return;

    const form = new FormData(e.currentTarget);
    const email = String(form.get('email')).trim();

    // Catch a malformed address before spending a network round trip — and
    // before it burns one of the auth rate-limit attempts.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Enter a valid email address');
      emailRef.current?.focus();
      return;
    }

    setLoading(true);
    setFormError(null);
    setEmailError(undefined);

    try {
      await login({ email, password: String(form.get('password')) });
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email);
      } catch {
        /* non-fatal */
      }
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 429) {
          // Tell them exactly how long, rather than "try again later".
          setCooldown(err.retryAfter ?? 60);
          setFormError('Too many attempts. The form unlocks automatically below.');
        } else {
          // Shown verbatim: the API returns one message for both "no such
          // account" and "wrong password", so login can't be used to enumerate
          // which emails are registered.
          setFormError(err.message);
        }
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    // min-h so the aside reaches the bottom of the viewport instead of ending
    // partway down and leaving a bare strip beneath it.
    <div className="grid min-h-[calc(100vh-72px)] lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Log in to TrustLance
          </h1>
          <p className="mt-3 text-muted">Pick up where you left off.</p>

          {justRegistered && (
            <div className="mt-6 rounded-xl bg-success-bg px-4 py-3 text-success">
              Account created. Log in to continue.
            </div>
          )}
          {oauthError && (
            <div className="mt-6 rounded-xl bg-danger-bg px-4 py-3 text-danger" role="alert">
              {oauthError}
            </div>
          )}
          {sessionExpired && (
            <div className="mt-6 rounded-xl bg-warning-bg px-4 py-3 text-warning">
              Your session ended. Log in again to pick up where you left off.
            </div>
          )}

          <div className="mt-9">
            <OAuthButtons intent="login" />
          </div>

          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-6" noValidate>
            <Field
              ref={emailRef}
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="you@example.com"
              error={emailError}
              onChange={() => emailError && setEmailError(undefined)}
            />

            <PasswordField
              label="Password"
              name="password"
              autoComplete="current-password"
              required
            />

            <FormError message={formError} />

            {cooldown > 0 && (
              <p role="status" className="text-center text-sm font-medium text-muted">
                Unlocks in{' '}
                <span className="tabular-nums text-foreground">
                  {Math.floor(cooldown / 60)}:{String(cooldown % 60).padStart(2, '0')}
                </span>
              </p>
            )}

            <Button
              type="submit"
              loading={loading}
              disabled={cooldown > 0}
              size="lg"
              className="w-full"
            >
              {cooldown > 0 ? 'Locked' : 'Log in'}
            </Button>
          </form>

          <p className="mt-8 text-muted">
            No account yet?{' '}
            <Link href="/register" className="link font-medium">
              Sign up free
            </Link>
          </p>

          {/* Secondary path: verifying a record needs no account at all, and
              some visitors arrive wanting only that. */}
          <div className="mt-10 border-t border-border pt-6">
            <p className="text-sm text-muted">
              Just here to check someone’s work record?{' '}
              <Link href="/verify" className="link font-medium">
                Verify one without an account
              </Link>
              .
            </p>
          </div>

          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-muted hover:text-foreground">
              Trouble signing in?
            </summary>
            <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-muted">
              <li>Passwords are at least 12 characters — check Caps Lock.</li>
              <li>
                Email is case-insensitive, so <code className="text-xs">Ada@</code> and{' '}
                <code className="text-xs">ada@</code> are the same account.
              </li>
              <li>Signed up with Google? Use the Google button rather than a password.</li>
              <li>
                There’s no password reset in this build. Create a new account if you’re locked out.
              </li>
            </ul>
          </details>
        </div>
      </div>

      <AuthAside variant="login" />
    </div>
  );
}
