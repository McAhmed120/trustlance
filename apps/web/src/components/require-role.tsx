'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { Role } from '@trustlance/shared-types';
import { useAuthStore } from '@/stores/auth';
import { Spinner } from './ui';

/**
 * Client-side route guard.
 *
 * Convenience only — never a security boundary. Every protected action is
 * authorised again on the server; this just avoids rendering a page the user
 * can’t use. It waits for `status` to settle before redirecting, so a page
 * reload doesn’t bounce an authenticated user to /login.
 */
export function RequireRole({ role, children }: { role?: Role | Role[]; children: React.ReactNode }) {
  const { user, status } = useAuthStore();
  const router = useRouter();
  const allowed = role ? (Array.isArray(role) ? role : [role]) : null;

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status === 'loading') return <Spinner />;
  if (status === 'anonymous' || !user) return <Spinner label="Redirecting…" />;

  if (allowed && !allowed.includes(user.role)) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="font-medium">Not available for your account type</p>
        <p className="mt-1 text-sm text-muted">
          This page is for {allowed.map((r) => r.toLowerCase()).join(' or ')} accounts. You’re signed in
          as a {user.role.toLowerCase()}.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
