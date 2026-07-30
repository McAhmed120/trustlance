'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE, apiRequest } from '@/lib/api';
import { money, useNotificationRealtime, useNotifications, useWallet } from '@/lib/hooks';
import { useAuthStore } from '@/stores/auth';
import { Avatar } from './ui';
import { ThemeToggle } from './theme';

interface NavItem {
  label: string;
  href: string;
  /** Present ⇒ rendered as a dropdown, as in Upwork's top bar. */
  children?: { label: string; href: string; hint?: string }[];
}

/**
 * Top bar, following the reference: one row only — brand, nav with dropdown
 * carets, then actions on the right. The previous version added a second row of
 * links below on mobile, which pushed page content down on every screen; that's
 * now a slide-down menu behind a hamburger instead.
 */
export function SiteHeader() {
  const { user, status, logout } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  async function handleLogout() {
    await logout();
    setAccountOpen(false);
    setMobileOpen(false);
    router.push('/login');
  }

  const nav: NavItem[] =
    status === 'authenticated' && user
      ? user.role === 'ADMIN'
        ? [
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Disputes', href: '/admin/disputes' },
            { label: 'Find work', href: '/jobs' },
            { label: 'Verify', href: '/verify' },
          ]
        : [
            { label: 'Dashboard', href: '/dashboard' },
            user.role === 'CLIENT'
              ? {
                  label: 'Hire talent',
                  href: '/jobs',
                  children: [
                    { label: 'Post a job', href: '/jobs/new', hint: 'Free — nothing is charged' },
                    { label: 'Browse all jobs', href: '/jobs', hint: 'See what others are posting' },
                    { label: 'Your contracts', href: '/dashboard', hint: 'Milestones and escrow' },
                  ],
                }
              : {
                  label: 'Find work',
                  href: '/jobs',
                  children: [
                    { label: 'Browse jobs', href: '/jobs', hint: 'Open roles across categories' },
                    { label: 'Your proposals', href: '/dashboard', hint: 'Track what you sent' },
                    { label: 'Your contracts', href: '/dashboard', hint: 'Active and completed' },
                  ],
                },
            {
              label: 'Manage finances',
              href: '/wallet',
              children: [
                { label: 'Wallet', href: '/wallet', hint: 'Balance and escrow' },
                { label: 'Transaction ledger', href: '/wallet', hint: 'Append-only history' },
              ],
            },
            {
              label: 'Trust',
              href: '/verify',
              children: [
                { label: 'Verify a record', href: '/verify', hint: 'No account needed' },
                { label: 'Your trust profile', href: '/profile', hint: 'What clients see' },
              ],
            },
          ]
      : [
          { label: 'Find work', href: '/jobs' },
          { label: 'Verify a record', href: '/verify' },
        ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const avatarSrc = user?.profile?.avatarUrl ? `${API_BASE}${user.profile.avatarUrl}` : null;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      {/*
        Three-part bar: brand + nav pinned left, actions pinned right, with the
        space between them absorbed by the gap. justify-between on the outer
        flex is what keeps the actions hard against the right edge at every
        width instead of drifting toward the nav on wide screens.
      */}
      <div className="container-wide flex h-[72px] items-center justify-between gap-6">
        {/* ------------------------------------------------- brand + nav -- */}
        <div className="flex min-w-0 flex-1 items-center gap-12">
          {/*
            Wordmark, matching the reference: lowercase, tight tracking, with a
            single accent dot instead of a boxed logo tile. The tile read as a
            generic app icon; a wordmark reads as a brand.
          */}
          <Link
            href="/"
            className="shrink-0 text-2xl font-bold lowercase tracking-[-0.03em] text-foreground"
          >
            trustlance
            <span aria-hidden className="text-accent">
              .
            </span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
            {nav.map((item) =>
              item.children ? (
                <div
                  key={item.label}
                  className="relative"
                  // Hover opens on desktop; click still works and is what
                  // keyboard and touch users get.
                  onMouseEnter={() => setOpenMenu(item.label)}
                  onMouseLeave={() => setOpenMenu(null)}
                >
                  <button
                    onClick={() => setOpenMenu((c) => (c === item.label ? null : item.label))}
                    aria-expanded={openMenu === item.label}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 transition-colors ${
                      isActive(item.href) ? 'font-medium text-foreground' : 'text-foreground/85 hover:text-accent'
                    }`}
                  >
                    {item.label}
                    <svg
                      aria-hidden
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className={`transition-transform ${openMenu === item.label ? 'rotate-180' : ''}`}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {openMenu === item.label && (
                    <div className="absolute left-0 top-full z-20 w-72 overflow-hidden rounded-xl border border-border bg-surface py-2 shadow-xl">
                      {item.children.map((c) => (
                        <Link
                          key={c.label}
                          href={c.href}
                          onClick={() => setOpenMenu(null)}
                          className="block px-4 py-2.5 hover:bg-surface-2"
                        >
                          <span className="block font-medium">{c.label}</span>
                          {c.hint && <span className="mt-0.5 block text-sm text-muted">{c.hint}</span>}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={`rounded-lg px-3 py-2 transition-colors ${
                    isActive(item.href) ? 'font-medium text-foreground' : 'text-foreground/85 hover:text-accent'
                  }`}
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        </div>

        {/* ---------------------------------------------------- actions -- */}
        <div className="flex shrink-0 items-center gap-2">
          {status === 'loading' && <span className="px-2 text-muted">…</span>}

          {status === 'anonymous' && (
            <>
              <ThemeToggle />
              {/* Plain text vs. solid green pill — the reference's exact
                  hierarchy: log-in recedes, sign-up is the one bright target. */}
              <Link
                href="/login"
                className="hidden px-4 py-2 font-medium text-foreground hover:text-accent sm:inline"
              >
                Log in
              </Link>
              <Link href="/register" className="btn-primary px-7">
                Sign up
              </Link>
            </>
          )}

          {status === 'authenticated' && user && (
            <>
              {user.role !== 'ADMIN' && <WalletChip />}
              <ThemeToggle />
              <NotificationBell />

              <div className="relative hidden lg:block">
                <button
                  onClick={() => setAccountOpen((o) => !o)}
                  aria-expanded={accountOpen}
                  aria-label="Account menu"
                  className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-surface-2"
                >
                  <Avatar name={user.profile?.displayName ?? 'User'} src={avatarSrc} size="sm" />
                  <svg
                    aria-hidden
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="text-muted"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {accountOpen && (
                  <>
                    <button
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setAccountOpen(false)}
                      aria-hidden
                      tabIndex={-1}
                    />
                    <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                      <div className="flex items-center gap-3 border-b border-border p-4">
                        <Avatar name={user.profile?.displayName ?? 'User'} src={avatarSrc} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{user.profile?.displayName}</p>
                          <p className="truncate text-sm capitalize text-muted">
                            {user.role.toLowerCase()}
                          </p>
                        </div>
                      </div>
                      <Link
                        href="/profile"
                        onClick={() => setAccountOpen(false)}
                        className="block px-4 py-3 hover:bg-surface-2"
                      >
                        Profile settings
                      </Link>
                      <Link
                        href={`/u/${user.id}`}
                        onClick={() => setAccountOpen(false)}
                        className="block px-4 py-3 hover:bg-surface-2"
                      >
                        Public trust profile
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="block w-full border-t border-border px-4 py-3 text-left text-muted hover:bg-surface-2 hover:text-foreground"
                      >
                        Log out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Hamburger replaces the old always-visible second nav row. */}
          <button
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label="Menu"
            className="grid size-10 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground lg:hidden"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
            </svg>
          </button>
        </div>
      </div>

      {/* ------------------------------------------------- mobile drawer -- */}
      {mobileOpen && (
        <div className="border-t border-border bg-surface lg:hidden">
          <nav aria-label="Main (mobile)" className="container-wide flex flex-col py-2">
            {nav.map((item) => (
              <div key={item.label}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`block py-3 ${isActive(item.href) ? 'font-medium' : 'text-muted'}`}
                >
                  {item.label}
                </Link>
                {item.children && (
                  <div className="mb-2 ml-4 flex flex-col border-l border-border pl-4">
                    {item.children.map((c) => (
                      <Link
                        key={c.label}
                        href={c.href}
                        onClick={() => setMobileOpen(false)}
                        className="py-2 text-sm text-muted"
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {status === 'authenticated' && user && (
              <div className="mt-2 flex flex-col border-t border-border pt-2">
                <Link href="/profile" onClick={() => setMobileOpen(false)} className="py-3 text-muted">
                  Profile settings
                </Link>
                <button onClick={handleLogout} className="py-3 text-left text-muted">
                  Log out
                </button>
              </div>
            )}
            {status === 'anonymous' && (
              <Link href="/login" onClick={() => setMobileOpen(false)} className="border-t border-border py-3 text-muted">
                Log in
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

function WalletChip() {
  const { data } = useWallet();
  if (!data) return null;
  return (
    <Link
      href="/wallet"
      title="Available balance"
      className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm tabular-nums transition-colors hover:border-accent hover:text-accent sm:inline-flex"
    >
      <span aria-hidden className="size-2 rounded-full bg-accent" />
      {money(data.balanceCents)}
    </Link>
  );
}

function NotificationBell() {
  const { data: notifications } = useNotifications();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  useNotificationRealtime();

  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;

  async function markRead() {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread > 0) void markRead();
        }}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
        className="relative grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden
            tabIndex={-1}
          />
          <div className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
            <p className="border-b border-border px-4 py-3 font-medium">Notifications</p>
            {notifications?.length === 0 && (
              <p className="px-4 py-10 text-center text-muted">Nothing yet.</p>
            )}
            <ul className="max-h-96 overflow-y-auto">
              {notifications?.map((n) => (
                <li key={n.id} className="border-b border-border last:border-0">
                  {n.payload.link ? (
                    <Link
                      href={n.payload.link}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-3 hover:bg-surface-2"
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-border' : 'bg-accent'}`}
                      />
                      <span>
                        {n.payload.title}
                        <span className="mt-0.5 block text-sm text-muted">
                          {new Date(n.createdAt).toLocaleString()}
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <div className="flex gap-3 px-4 py-3">
                      <span
                        aria-hidden
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-border' : 'bg-accent'}`}
                      />
                      <span>
                        {n.payload.title}
                        <span className="mt-0.5 block text-sm text-muted">
                          {new Date(n.createdAt).toLocaleString()}
                        </span>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
