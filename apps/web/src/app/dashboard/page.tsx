'use client';

import Link from 'next/link';
import { money, useMyContracts, useMyJobs, useMyProposals, useWallet } from '@/lib/hooks';
import { useAuthStore } from '@/stores/auth';
import { RequireRole } from '@/components/require-role';
import {
  Avatar,
  Card,
  Empty,
  MilestoneProgress,
  Pill,
  Section,
  Spinner,
  Stat,
  StateBadge,
} from '@/components/ui';

export default function DashboardPage() {
  return (
    <RequireRole>
      <Dashboard />
    </RequireRole>
  );
}

function Dashboard() {
  const user = useAuthStore((s) => s.user)!;
  const isClient = user.role === 'CLIENT';
  const isAdmin = user.role === 'ADMIN';
  const { data: contracts } = useMyContracts();
  const { data: wallet } = useWallet();

  const active = contracts?.filter((c) => c.status === 'ACTIVE').length ?? 0;
  const completed = contracts?.filter((c) => c.status === 'COMPLETED').length ?? 0;

  return (
    <div className="container-wide py-10">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Avatar name={user.profile?.displayName ?? 'User'} size="lg" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {user.profile?.displayName ?? 'Welcome'}
            </h1>
            <p className="mt-1 text-muted">
              <span className="capitalize">{user.role.toLowerCase()}</span> account
              {!user.emailVerified && (
                <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-sm text-warning">
                  email unverified
                </span>
              )}
            </p>
          </div>
        </div>

        {isAdmin ? (
          <Link href="/admin/disputes" className="btn-primary">
            Dispute queue
          </Link>
        ) : isClient ? (
          <Link href="/jobs/new" className="btn-primary">
            Post a job
          </Link>
        ) : (
          <Link href="/jobs" className="btn-primary">
            Find work
          </Link>
        )}
      </div>

      {/* Stat row — the numbers a user opens the dashboard to see. */}
      {!isAdmin && (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Available" value={money(wallet?.balanceCents ?? 0)} tone="accent" />
          <Stat label="In escrow" value={money(wallet?.inEscrowCents ?? 0)} tone="info" />
          <Stat label="Active contracts" value={active} />
          <Stat label="Completed" value={completed} />
        </div>
      )}

      <ContractsSection isClient={isClient} />
      {isClient && <MyJobsSection />}
      {user.role === 'FREELANCER' && <MyProposalsSection />}
    </div>
  );
}

function ContractsSection({ isClient }: { isClient: boolean }) {
  const { data: contracts, isLoading } = useMyContracts();

  return (
    <Section
      title="Contracts"
      description="Milestone escrow, chat, and time logs live in each workspace."
    >
      {isLoading && <Spinner />}
      {contracts?.length === 0 && (
        <Empty
          title="No contracts yet"
          body={
            isClient
              ? 'Accept a proposal on one of your jobs to create a contract.'
              : 'Submit proposals to win work and start a contract.'
          }
          action={
            <Link href={isClient ? '/jobs/new' : '/jobs'} className="btn-primary">
              {isClient ? 'Post a job' : 'Browse jobs'}
            </Link>
          }
        />
      )}

      <ul className="flex flex-col gap-4">
        {contracts?.map((c) => (
          <Card key={c.id} as="li" hover className="p-0">
            <Link href={`/contracts/${c.id}`} className="block p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold leading-snug">{c.jobTitle}</h3>
                  <div className="mt-2 flex items-center gap-2 text-muted">
                    <Avatar name={isClient ? c.freelancerName : c.clientName} size="sm" />
                    <span>
                      with {isClient ? c.freelancerName : c.clientName}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-semibold tabular-nums">
                    {money(c.totalAmountCents)}
                  </p>
                  <Pill>
                    <span className="capitalize">{c.status.toLowerCase()}</span>
                  </Pill>
                </div>
              </div>

              <div className="mt-5 max-w-sm">
                <MilestoneProgress states={c.milestones.map((m) => m.state)} />
              </div>

              <ul className="mt-4 flex flex-wrap gap-2">
                {c.milestones.map((m) => (
                  <li key={m.id}>
                    <StateBadge state={m.state} size="sm" />
                  </li>
                ))}
              </ul>
            </Link>
          </Card>
        ))}
      </ul>
    </Section>
  );
}

function MyJobsSection() {
  const { data: jobs, isLoading } = useMyJobs();
  return (
    <Section
      title="Your job posts"
      action={
        <Link href="/jobs/new" className="btn-secondary btn-sm">
          Post another
        </Link>
      }
    >
      {isLoading && <Spinner />}
      {jobs?.length === 0 && <Empty title="No jobs posted yet" />}
      <ul className="flex flex-col gap-3">
        {jobs?.map((j) => (
          <Card key={j.id} as="li" hover className="p-0">
            <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{j.title}</h3>
                <p className="mt-0.5 text-sm text-muted">
                  {j.proposalCount} proposal{j.proposalCount === 1 ? '' : 's'} ·{' '}
                  <span className="capitalize">{j.category.replace(/-/g, ' ')}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <Pill>
                  <span className="capitalize">{j.status.toLowerCase()}</span>
                </Pill>
                <span className="text-lg font-semibold tabular-nums">{money(j.budgetCents)}</span>
              </div>
            </Link>
          </Card>
        ))}
      </ul>
    </Section>
  );
}

function MyProposalsSection() {
  const { data: proposals, isLoading } = useMyProposals();
  return (
    <Section title="Your proposals">
      {isLoading && <Spinner />}
      {proposals?.length === 0 && (
        <Empty
          title="No proposals yet"
          body="Browse open jobs and submit your first proposal."
          action={
            <Link href="/jobs" className="btn-primary">
              Find work
            </Link>
          }
        />
      )}
      <ul className="flex flex-col gap-3">
        {proposals?.map((p) => (
          <Card key={p.id} as="li" hover className="p-0">
            <Link href={`/jobs/${p.jobId}`} className="flex items-center justify-between gap-4 p-5">
              <h3 className="min-w-0 truncate font-semibold">{p.jobTitle ?? 'Job'}</h3>
              <div className="flex shrink-0 items-center gap-4">
                <Pill>
                  <span className="capitalize">{p.status.toLowerCase()}</span>
                </Pill>
                <span className="text-lg font-semibold tabular-nums">{money(p.amountCents)}</span>
              </div>
            </Link>
          </Card>
        ))}
      </ul>
    </Section>
  );
}
