'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import type { Role } from '@trustlance/shared-types';
import { useAuthStore } from '@/stores/auth';
import { ApiClientError } from '@/lib/api';
import { Button, Field, FormError } from '@/components/ui';
import { PasswordField } from '@/components/password-field';
import { AuthAside } from '@/components/auth-aside';
import { OAuthButtons } from '@/components/oauth-buttons';

export default function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const router = useRouter();

  const [role, setRole] = useState<Extract<Role, 'FREELANCER' | 'CLIENT'>>('FREELANCER');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    try {
      await register({
        email: String(form.get('email')),
        password: String(form.get('password')),
        displayName: String(form.get('displayName')),
        role,
      });
      router.push('/profile');
    } catch (err) {
      if (err instanceof ApiClientError) {
        // Map the API's field-level details onto the inputs so the user sees
        // "at least 12 characters" under the password box, not in a banner.
        if (err.details) {
          setFieldErrors(
            Object.fromEntries(Object.entries(err.details).map(([k, v]) => [k, v[0] ?? ''])),
          );
        }
        setFormError(err.details ? null : err.message);
      } else {
        setFormError('Could not reach the server. Is the API running?');
      }
    } finally {
      setLoading(false);
    }
  }

  const roles = [
    {
      value: 'FREELANCER' as const,
      label: 'freelancer',
      title: 'I’m a freelancer',
      body: 'Find work and build a reputation you can take anywhere.',
      icon: <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6z" />,
    },
    {
      value: 'CLIENT' as const,
      label: 'client',
      title: 'I’m a client',
      body: 'Hire talent and pay only for milestones you approve.',
      icon: (
        <>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </>
      ),
    },
  ];

  return (
    <div className="grid min-h-[calc(100vh-72px)] lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create your account</h1>
          <p className="mt-3 text-muted">
            Free to join. Your reputation record belongs to you, not to this platform.
          </p>

          <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-7">
            <fieldset className="flex flex-col gap-3">
              <legend className="label mb-2">I want to join as…</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {roles.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    aria-pressed={role === r.value}
                    className={`flex flex-col gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                      role === r.value
                        ? 'border-accent bg-accent-soft'
                        : 'border-border hover:border-border-strong'
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <svg
                        aria-hidden
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className={role === r.value ? 'text-accent' : 'text-muted'}
                      >
                        {r.icon}
                      </svg>
                      <span
                        aria-hidden
                        className={`grid size-5 place-items-center rounded-full border-2 ${
                          role === r.value ? 'border-accent' : 'border-border-strong'
                        }`}
                      >
                        {role === r.value && <span className="size-2.5 rounded-full bg-accent" />}
                      </span>
                    </span>
                    <span className="block font-medium">{r.title}</span>
                    <span className="block text-sm leading-snug text-muted">{r.body}</span>
                    {/* Keeps the bare role word in the accessible name. */}
                    <span className="sr-only">{r.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <OAuthButtons intent="signup" role={role} />

            <Field
              label="Full name"
              name="displayName"
              autoComplete="name"
              required
              placeholder="Ada Lovelace"
              error={fieldErrors.displayName}
            />
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              error={fieldErrors.email}
            />
            <PasswordField
              label="Password"
              name="password"
              autoComplete="new-password"
              required
              showStrength
              hint="At least 12 characters. Length beats symbols."
              error={fieldErrors.password}
            />

            <FormError message={formError} />

            <Button type="submit" loading={loading} size="lg" className="w-full">
              Create account
            </Button>

            <p className="text-center text-sm text-muted">
              No card required · escrow is simulated in this build
            </p>
          </form>

          <p className="mt-8 text-muted">
            Already have an account?{' '}
            <Link href="/login" className="link font-medium">
              Log in
            </Link>
          </p>
        </div>
      </div>

      <AuthAside variant="register" />
    </div>
  );
}
