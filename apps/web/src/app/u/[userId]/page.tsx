import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PublicUserDto, WorkRecordDto } from '@trustlance/shared-types';
import { API_BASE } from '@/lib/api';

/**
 * Public trust profile (§5).
 *
 * A Server Component with no auth: anyone doing due diligence on a freelancer
 * must be able to read this, including someone with no TrustLance account.
 * That is the whole point of portable reputation.
 *
 * `params` is a Promise in Next 16 — synchronous access was removed in v16.
 */
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const [userRes, recordsRes] = await Promise.all([
    fetch(`${API_BASE}/api/users/${userId}`, { cache: 'no-store' }).catch(() => null),
    fetch(`${API_BASE}/api/reputation/${userId}/records`, { cache: 'no-store' }).catch(() => null),
  ]);

  if (!userRes || !userRes.ok) notFound();

  const user = (await userRes.json()) as PublicUserDto;
  const records: WorkRecordDto[] = recordsRes?.ok ? await recordsRes.json() : [];
  const p = user.profile;

  const totalEarnedCents = records.reduce((s, r) => s + r.payload.amountCents, 0);
  const rated = records.filter((r) => r.payload.rating != null);
  const avgRating = rated.length
    ? rated.reduce((s, r) => s + (r.payload.rating ?? 0), 0) / rated.length
    : null;

  const usd = (cents: number) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const name = p?.displayName ?? 'Unnamed user';
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="container-wide py-10">
      {/* ------------------------------------------------------------ header -- */}
      <div className="flex flex-wrap items-start gap-6">
        {p?.avatarUrl ? (
          // Plain <img>: a user upload served from the API origin, which would
          // need that host allow-listed to pass through next/image for no gain.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${API_BASE}${p.avatarUrl}`}
            alt={`${name}'s profile picture`}
            className="size-24 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-24 shrink-0 place-items-center rounded-full bg-accent-soft text-3xl font-semibold text-accent"
          >
            {initials || '?'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span className="capitalize">{user.role.toLowerCase()}</span>
            <span aria-hidden>·</span>
            <span>Member since {new Date(user.createdAt).toLocaleDateString()}</span>
            {p?.hourlyRateCents != null && (
              <>
                <span aria-hidden>·</span>
                <span className="font-medium text-foreground tabular-nums">
                  {usd(p.hourlyRateCents)}/hr
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_20rem]">
        {/* ---------------------------------------------------------- main --- */}
        <div className="min-w-0">
          {p?.bio && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">About</h2>
              <p className="mt-3 whitespace-pre-wrap text-lg leading-relaxed">{p.bio}</p>
            </section>
          )}

          {p?.skills.length ? (
            <section className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Skills</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {p.skills.map((s) => (
                  <li key={s} className="rounded-full bg-surface-3 px-4 py-2 text-muted">
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {p?.portfolioLinks.length ? (
            <section className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Portfolio
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {p.portfolioLinks.map((link) => (
                  <li key={link}>
                    <a
                      href={link}
                      target="_blank"
                      // noreferrer alongside noopener: user-supplied URLs.
                      rel="noopener noreferrer"
                      className="link break-all"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ------------------------------------------------- work records -- */}
          <section className="mt-12">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 className="text-2xl font-semibold tracking-tight">Verified work records</h2>
              {records.length > 0 && (
                <span className="text-lg font-semibold tabular-nums text-accent">
                  {usd(totalEarnedCents)} earned
                </span>
              )}
            </div>

            {records.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface-2 px-8 py-12 text-center">
                <p className="font-medium">No completed contracts yet</p>
                <p className="mt-2 text-muted">
                  A signed record appears here after the first approved milestone.
                </p>
              </div>
            ) : (
              <>
                <p className="mt-2 text-muted">
                  Each record is cryptographically signed.{' '}
                  <Link href="/verify" className="link">
                    Verify any of them yourself
                  </Link>{' '}
                  — no account required.
                </p>

                <ul className="mt-6 flex flex-col gap-4">
                  {records.map((r) => (
                    <li key={r.id} className="card">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-fg"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            </span>
                            <h3 className="text-lg font-semibold">{r.payload.title}</h3>
                          </div>
                          <p className="mt-1.5 text-sm text-muted">
                            Completed {new Date(r.payload.completedAt).toLocaleDateString()}
                            {r.payload.rating != null && (
                              <>
                                {' · '}
                                <span aria-hidden className="text-accent">
                                  {'★'.repeat(r.payload.rating)}
                                </span>{' '}
                                {r.payload.rating}/5
                              </>
                            )}
                          </p>
                        </div>
                        <span className="shrink-0 text-xl font-semibold tabular-nums">
                          {usd(r.payload.amountCents)}
                        </span>
                      </div>

                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm text-muted hover:text-foreground">
                          Show signed record (JWS)
                        </summary>
                        <code className="mt-3 block max-h-40 overflow-auto rounded-xl bg-surface-2 p-4 font-mono text-xs break-all">
                          {r.jws}
                        </code>
                      </details>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* -------------------------------------------------------- sidebar -- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="card text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-muted">Trust score</p>
            {user.trustScore == null ? (
              <>
                <p className="mt-3 text-4xl font-semibold text-muted">—</p>
                <p className="mt-2 text-sm text-muted">
                  No completed contracts yet — a score appears after the first approved milestone.
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-5xl font-semibold tabular-nums text-accent">
                  {user.trustScore.toFixed(1)}
                </p>
                <p className="mt-1 text-sm text-muted">out of 100</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${user.trustScore}%` }}
                  />
                </div>
                <p className="mt-4 text-left text-sm text-muted">
                  Computed from completed contracts, average rating, dispute rate, and account age.
                  Not editable by the user.
                </p>
              </>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="card text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Completed</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{records.length}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Avg rating</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {avgRating == null ? '—' : avgRating.toFixed(1)}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-surface-2 p-5 text-sm text-muted">
            <p className="font-medium text-foreground">Why you can trust this page</p>
            <p className="mt-2 leading-relaxed">
              These records aren’t self-reported. Each one was signed by the platform at the moment a
              client approved and released escrow, and can be verified independently.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
