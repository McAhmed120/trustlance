'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MeDto, UpdateProfileDto } from '@trustlance/shared-types';
import { useAuthStore } from '@/stores/auth';
import { API_BASE, ApiClientError, apiRequest, getAccessToken } from '@/lib/api';
import { money, useMyContracts, usePublicUser, useWallet, useWorkRecords } from '@/lib/hooks';
import { Avatar, Banner, Button, Empty, Field, FormError, Spinner, TextareaField } from '@/components/ui';
import { AvatarUpload } from '@/components/avatar-upload';
import { PencilButton, ProfileCard, SidebarBlock, VerifiedCheck } from '@/components/profile-bits';

/**
 * Own-profile page, following Upwork's layout: one wide card with an identity
 * header and a two-column body (narrow left rail of small blocks, wide right
 * column for the substantive content), then a stack of separate section cards
 * below it.
 *
 * Every pencil edits a field the existing API already accepts — this page adds
 * no backend surface. Where Upwork shows fields TrustLance doesn't have
 * (languages, education, licences, Connects), the slot is filled with the real
 * equivalent: wallet, trust score, signed records, contract history.
 */
export default function ProfilePage() {
  const { user, status, setUser } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated' || !user) return <Spinner />;

  return <ProfileView user={user} setUser={setUser} />;
}

type EditKey = 'name' | 'bio' | 'rate' | 'skills' | 'links' | null;

function ProfileView({ user, setUser }: { user: MeDto; setUser: (u: MeDto) => void }) {
  const [editing, setEditing] = useState<EditKey>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const { data: wallet } = useWallet();
  const { data: contracts } = useMyContracts();
  const { data: records } = useWorkRecords(user.id);
  const { data: publicUser } = usePublicUser(user.id);

  const p = user.profile;
  const isFreelancer = user.role === 'FREELANCER';

  async function save(patch: UpdateProfileDto) {
    setSaving(true);
    setError(null);
    try {
      const updated = await apiRequest<MeDto>('/api/users/me', { method: 'PATCH', body: patch });
      setUser(updated);
      setEditing(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? (err.details ? Object.values(err.details)[0]?.[0] : null) ?? err.message
          : 'Could not save.',
      );
    } finally {
      setSaving(false);
    }
  }

  const toggle = (k: Exclude<EditKey, null>) => setEditing((cur) => (cur === k ? null : k));

  const totalEarned = records?.reduce((s, r) => s + r.payload.amountCents, 0) ?? 0;
  const completedContracts = contracts?.filter((c) => c.status === 'COMPLETED').length ?? 0;

  // Avatars are served from the API origin, so the stored URL is path-only.
  const avatarSrc = p?.avatarUrl ? `${API_BASE}${p.avatarUrl}` : null;

  return (
    <div className="container-wide py-8">
      {savedFlash && (
        <div className="mb-6">
          <Banner tone="success">Profile updated.</Banner>
        </div>
      )}

      {/* ══════════════════════════════════ main card ══════════════════════ */}
      <div className="rounded-2xl border border-border bg-surface">
        {/* ---------------------------------------------- identity header -- */}
        <div className="flex flex-wrap items-start justify-between gap-6 p-6">
          <div className="flex min-w-0 items-center gap-5">
            <div className="relative shrink-0">
              <Avatar name={p?.displayName ?? 'User'} src={avatarSrc} size="lg" />
              {/* Online dot, as on the reference's avatar. */}
              <span
                aria-hidden
                className="absolute left-0.5 top-0.5 size-4 rounded-full border-2 border-surface bg-accent"
                title="Online"
              />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-tight">
                  {p?.displayName ?? 'Your name'}
                </h1>
                <VerifiedCheck verified={user.emailVerified} />
                <PencilButton label="Edit name" onClick={() => toggle('name')} active={editing === 'name'} />
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
                <span className="capitalize">{user.role.toLowerCase()}</span>
                <span aria-hidden>·</span>
                <span>{user.email}</span>
                <span aria-hidden>·</span>
                <span>Member since {new Date(user.createdAt).toLocaleDateString()}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/u/${user.id}`} className="btn-secondary btn-sm">
              See public view
            </Link>
            <Link href="/verify" className="btn-ghost btn-sm">
              Verify a record
            </Link>
          </div>
        </div>

        {editing === 'name' && (
          <div className="border-t border-border bg-surface-2 p-6">
            <InlineForm
              saving={saving}
              error={error}
              onCancel={() => setEditing(null)}
              onSubmit={(fd) => void save({ displayName: String(fd.get('displayName')) })}
            >
              <Field label="Full name" name="displayName" defaultValue={p?.displayName ?? ''} required />
            </InlineForm>
          </div>
        )}

        {/* ------------------------------------------------- two-column body -- */}
        <div className="grid border-t border-border lg:grid-cols-[19rem_1fr]">
          {/* ░░░░░░░░░░░░░░░░░░░░░░ left rail ░░░░░░░░░░░░░░░░░░░░░░ */}
          <aside className="border-b border-border p-6 lg:border-b-0 lg:border-r">
            <div className="mb-5 rounded-xl border border-border p-4">
              <AvatarUpload user={user} onChange={setUser} />
            </div>

            {/* Wallet — occupies Upwork's "Promote with ads" slot. */}
            {user.role !== 'ADMIN' && (
              <div className="rounded-xl bg-surface-3 p-4">
                <p className="font-semibold">Wallet</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Available</dt>
                    <dd className="font-semibold tabular-nums text-accent">
                      {money(wallet?.balanceCents ?? 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">In escrow</dt>
                    <dd className="font-semibold tabular-nums text-info">
                      {money(wallet?.inEscrowCents ?? 0)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-center gap-3 border-t border-border pt-3 text-sm">
                  <Link href="/wallet" className="font-medium text-accent hover:underline">
                    View ledger
                  </Link>
                  <span aria-hidden className="text-border">
                    |
                  </span>
                  <Link href="/wallet" className="font-medium text-accent hover:underline">
                    Add funds
                  </Link>
                </div>
              </div>
            )}

            {/* Trust score — occupies the "Connects: 200" slot. */}
            <div className="mt-4 rounded-xl bg-surface-3 p-4">
              <p className="font-semibold">
                Trust score:{' '}
                <span className="tabular-nums text-accent">
                  {publicUser?.trustScore != null ? publicUser.trustScore.toFixed(1) : 'none yet'}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted">
                Computed from signed records — not editable.
              </p>
              <Link
                href={`/u/${user.id}`}
                className="mt-3 inline-block border-t border-border pt-3 text-sm font-medium text-accent hover:underline"
              >
                See how clients view it
              </Link>
            </div>

            <div className="mt-6">
              <SidebarBlock title="Hourly rate" onEdit={() => toggle('rate')} editing={editing === 'rate'}>
                {editing === 'rate' ? (
                  <InlineForm
                    saving={saving}
                    error={error}
                    onCancel={() => setEditing(null)}
                    onSubmit={(fd) => {
                      const v = String(fd.get('hourlyRate')).trim();
                      void save({ hourlyRateCents: v === '' ? null : Math.round(Number(v) * 100) });
                    }}
                  >
                    <Field
                      label="Rate per hour"
                      name="hourlyRate"
                      type="number"
                      step="0.01"
                      min="0"
                      prefix="$"
                      defaultValue={p?.hourlyRateCents != null ? (p.hourlyRateCents / 100).toFixed(2) : ''}
                    />
                  </InlineForm>
                ) : p?.hourlyRateCents != null ? (
                  <p className="text-2xl font-semibold tabular-nums">
                    {money(p.hourlyRateCents)}
                    <span className="text-base font-normal text-muted">/hr</span>
                  </p>
                ) : (
                  <p className="text-muted">Not set</p>
                )}
              </SidebarBlock>

              <SidebarBlock title="Verifications">
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-muted">Email</span>
                    {user.emailVerified ? (
                      <span className="font-medium text-accent">Verified</span>
                    ) : (
                      <span className="font-medium text-warning">Pending</span>
                    )}
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-muted">Account type</span>
                    <span className="font-medium capitalize">{user.role.toLowerCase()}</span>
                  </li>
                </ul>
              </SidebarBlock>

              <SidebarBlock title="Portfolio links" onEdit={() => toggle('links')} editing={editing === 'links'}>
                {editing === 'links' ? (
                  <InlineForm
                    saving={saving}
                    error={error}
                    onCancel={() => setEditing(null)}
                    onSubmit={(fd) =>
                      void save({
                        portfolioLinks: String(fd.get('portfolioLinks'))
                          .split(/[\s,]+/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  >
                    <Field
                      label="Links"
                      name="portfolioLinks"
                      defaultValue={p?.portfolioLinks.join(', ') ?? ''}
                      hint="Full URLs, comma or space separated"
                    />
                  </InlineForm>
                ) : p?.portfolioLinks.length ? (
                  <ul className="flex flex-col gap-2 text-sm">
                    {p.portfolioLinks.map((l) => (
                      <li key={l}>
                        <a
                          href={l}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-accent hover:underline"
                        >
                          {l}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">None added</p>
                )}
              </SidebarBlock>

              <SidebarBlock title="Account">
                {/*
                  Labels spell out the unit. "Completed: 0" beside
                  "Signed records: 1" reads as a contradiction, when in fact a
                  contract stays active until its last milestone is paid — one
                  milestone can be signed while the contract is still running.
                */}
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Contracts completed</dt>
                    <dd className="font-medium tabular-nums">{completedContracts}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Milestones paid</dt>
                    <dd className="font-medium tabular-nums">{records?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">User ID</dt>
                    <dd className="mt-0.5 break-all font-mono text-xs text-muted">{user.id}</dd>
                  </div>
                </dl>
              </SidebarBlock>
            </div>
          </aside>

          {/* ░░░░░░░░░░░░░░░░░░░░░░ right column ░░░░░░░░░░░░░░░░░░░ */}
          <div className="min-w-0 p-6">
            {/* Overview — Upwork's title + rate row. */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>
              <div className="flex items-center gap-3">
                {p?.hourlyRateCents != null && (
                  <span className="text-xl font-semibold tabular-nums">
                    {money(p.hourlyRateCents)}
                    <span className="text-base font-normal text-muted">/hr</span>
                  </span>
                )}
                <PencilButton label="Edit bio" onClick={() => toggle('bio')} active={editing === 'bio'} />
              </div>
            </div>

            {editing === 'bio' ? (
              <div className="mt-4">
                <InlineForm
                  saving={saving}
                  error={error}
                  onCancel={() => setEditing(null)}
                  onSubmit={(fd) => void save({ bio: String(fd.get('bio')) || null })}
                >
                  <TextareaField
                    label="Bio"
                    name="bio"
                    rows={6}
                    defaultValue={p?.bio ?? ''}
                    placeholder="What you do, and what you’re good at."
                    hint="Shown on your public trust profile."
                  />
                </InlineForm>
              </div>
            ) : (
              <p className="mt-4 max-w-3xl whitespace-pre-wrap leading-relaxed text-muted">
                {p?.bio || 'No bio yet — add one so clients know what you do.'}
              </p>
            )}

            {/* Signed records — Upwork's Portfolio slot. */}
            <section className="mt-10 border-t border-border pt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-2xl font-semibold tracking-tight">Signed work records</h2>
                {records && records.length > 0 && (
                  <span className="font-semibold tabular-nums text-accent">
                    {money(totalEarned)} earned
                  </span>
                )}
              </div>

              {!records || records.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-border bg-surface-2 px-5 py-8 text-center text-muted">
                  No records yet. One is minted automatically each time a client approves a milestone.
                </p>
              ) : (
                <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {records.map((r) => (
                    <li key={r.id} className="rounded-xl border border-border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <span
                          aria-hidden
                          className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-accent-fg"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </span>
                        <span className="font-semibold tabular-nums">{money(r.payload.amountCents)}</span>
                      </div>
                      <p className="mt-3 font-medium leading-snug">{r.payload.title}</p>
                      <p className="mt-1 text-sm text-muted">
                        {new Date(r.payload.completedAt).toLocaleDateString()}
                        {r.payload.rating != null && (
                          <>
                            {' · '}
                            <span aria-hidden className="text-accent">
                              {'★'.repeat(r.payload.rating)}
                            </span>
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Contract history — Upwork's Work history slot. */}
            <section className="mt-10 border-t border-border pt-8">
              <h2 className="text-2xl font-semibold tracking-tight">Contract history</h2>
              {!contracts || contracts.length === 0 ? (
                <p className="mt-3 text-muted">No items</p>
              ) : (
                <ul className="mt-4 flex flex-col gap-3">
                  {contracts.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/contracts/${c.id}`}
                        className="flex items-center justify-between gap-4 rounded-xl border border-border p-4 transition-colors hover:border-accent"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.jobTitle}</span>
                          <span className="block text-sm text-muted">
                            with {user.role === 'CLIENT' ? c.freelancerName : c.clientName} ·{' '}
                            <span className="capitalize">{c.status.toLowerCase()}</span>
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {money(c.totalAmountCents)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Skills — Upwork's Skills slot, with the same "Self-reported" note. */}
            <section className="mt-10 border-t border-border pt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold tracking-tight">Skills</h2>
                <PencilButton label="Edit skills" onClick={() => toggle('skills')} active={editing === 'skills'} />
              </div>

              {editing === 'skills' ? (
                <div className="mt-4">
                  <InlineForm
                    saving={saving}
                    error={error}
                    onCancel={() => setEditing(null)}
                    onSubmit={(fd) =>
                      void save({
                        skills: String(fd.get('skills'))
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  >
                    <Field
                      label="Skills"
                      name="skills"
                      defaultValue={p?.skills.join(', ') ?? ''}
                      hint="Comma separated, e.g. React, PostgreSQL, Ed25519"
                    />
                  </InlineForm>
                </div>
              ) : (
                <>
                  <p className="mt-3 text-sm text-muted">Self-reported</p>
                  {p?.skills.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {p.skills.map((s) => (
                        <li key={s} className="rounded-full bg-surface-3 px-3 py-1.5 text-sm">
                          {s}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-muted">None added</p>
                  )}
                </>
              )}
            </section>

            {/* Reputation bundle — Upwork's project-catalog slot. */}
            <section className="mt-10 border-t border-border pt-8">
              <h2 className="text-2xl font-semibold tracking-tight">Your reputation bundle</h2>
              <p className="mt-2 max-w-2xl leading-relaxed text-muted">
                {isFreelancer
                  ? 'Export every signed record as one JSON bundle. It carries the platform’s public key, so anyone can verify it offline — and it stays provable even if TrustLance shuts down.'
                  : 'Freelancers you hire build signed records from your approvals. Clients don’t accumulate exportable records of their own.'}
              </p>
              {isFreelancer && (
                <div className="mt-5">
                  <ExportButton userId={user.id} />
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════ stacked cards below ═══════════════════ */}
      {records && records.length > 0 && (
        <ProfileCard
          title="Record details"
          subtitle="The exact signed document behind each completed milestone"
        >
          <ul className="flex flex-col gap-4">
            {records.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{r.payload.title}</p>
                    <p className="mt-1 text-sm text-muted">
                      Completed {new Date(r.payload.completedAt).toLocaleString()} · issued by{' '}
                      <code className="font-mono text-xs">{r.payload.platform}</code> · v{r.payload.v}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {money(r.payload.amountCents)}
                  </span>
                </div>
                <details className="mt-3">
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
        </ProfileCard>
      )}

      <ProfileCard
        title="Verify a record yourself"
        subtitle="The same check any third party can run — no account, no database"
      >
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span
            aria-hidden
            className="grid size-16 place-items-center rounded-2xl bg-accent-soft text-accent"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6l7-4z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </span>
          <p className="max-w-md text-muted">
            Paste any signed record into the public verifier and watch it check against the
            platform’s Ed25519 public key. Change one character and the signature fails.
          </p>
          <Link href="/verify" className="btn-secondary">
            Open the verifier
          </Link>
        </div>
      </ProfileCard>

      {!user.emailVerified && (
        <ProfileCard title="Email verification" subtitle="Required before some actions in production builds">
          <Empty
            title="Your email isn’t verified yet"
            body="In this build the verification link is written to the API server log rather than sent by email."
          />
        </ProfileCard>
      )}
    </div>
  );
}

/** Compact save/cancel form used by every pencil affordance. */
function InlineForm({
  children,
  onSubmit,
  onCancel,
  saving,
  error,
}: {
  children: React.ReactNode;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
      className="flex flex-col gap-4"
    >
      {children}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="sm" loading={saving}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Downloads the signed reputation bundle (§9 export).
 * Manual fetch + blob rather than a plain link: the endpoint needs the
 * Authorization header, since only the owner may export.
 */
function ExportButton({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/reputation/${userId}/export`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trustlance-reputation-${userId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" loading={busy} onClick={() => void download()}>
      Export reputation
    </Button>
  );
}
