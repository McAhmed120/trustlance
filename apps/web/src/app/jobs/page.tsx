'use client';

import Link from 'next/link';
import { useState } from 'react';
import { JOB_CATEGORIES } from '@trustlance/shared-types';
import { API_BASE } from '@/lib/api';
import { money, useJobs } from '@/lib/hooks';
import { useAuthStore } from '@/stores/auth';
import { Avatar, Card, Empty, Pill, Spinner } from '@/components/ui';

/** Relative time, so listings read as a live feed rather than a table dump. */
function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export default function JobsPage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [minBudget, setMinBudget] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { data: jobs, isLoading } = useJobs({ q, category, minBudget });
  const role = useAuthStore((s) => s.user?.role);

  const budgetBands = [
    { label: 'Any budget', value: '' },
    { label: '$500+', value: '50000' },
    { label: '$1,000+', value: '100000' },
    { label: '$5,000+', value: '500000' },
  ];

  return (
    <div className="container-wide py-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Find work</h1>
          <p className="mt-2 text-lg text-muted">
            Every contract here runs on milestone escrow with an auditable ledger.
          </p>
        </div>
        {role === 'CLIENT' && (
          <Link href="/jobs/new" className="btn-primary">
            Post a job
          </Link>
        )}
      </div>

      {/* Search bar spans the full width — it's the primary action on this page. */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <svg
            aria-hidden
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search job titles and descriptions…"
            aria-label="Search jobs"
            className="input pl-12"
          />
        </div>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[16rem_1fr]">
        {/*
          Filters: a plain sidebar from lg up, but a collapsed accordion on
          mobile. Expanded, the eleven options fill the entire first screen and
          push every job below the fold — a phone user would scroll past the
          whole filter list before seeing a single listing.
        */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          {/* Toggle button only exists below lg; the panel is always rendered
              there via lg:block, so desktop keeps a plain sidebar. */}
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-controls="job-filters"
            className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 lg:hidden"
          >
            <span className="text-lg font-semibold">Filters</span>
            <svg
              aria-hidden
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`text-muted transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <h2 className="hidden text-lg font-semibold lg:block">Filters</h2>

          <div id="job-filters" className={`${filtersOpen ? 'block' : 'hidden'} lg:block`}>
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold uppercase tracking-wider text-muted">
              Category
            </legend>
            <div className="mt-3 flex flex-col gap-1">
              <FilterButton active={category === ''} onClick={() => setCategory('')}>
                All categories
              </FilterButton>
              {JOB_CATEGORIES.map((c) => (
                <FilterButton key={c} active={category === c} onClick={() => setCategory(c)}>
                  <span className="capitalize">{c.replace(/-/g, ' ')}</span>
                </FilterButton>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-8">
            <legend className="text-sm font-semibold uppercase tracking-wider text-muted">
              Budget
            </legend>
            <div className="mt-3 flex flex-col gap-1">
              {budgetBands.map((b) => (
                <FilterButton
                  key={b.value}
                  active={minBudget === b.value}
                  onClick={() => setMinBudget(b.value)}
                >
                  {b.label}
                </FilterButton>
              ))}
            </div>
          </fieldset>
          </div>
        </aside>

        {/* ----------------------------------------------------------- list -- */}
        <div>
          {isLoading && <Spinner label="Loading jobs…" />}

          {jobs && (
            <p className="mb-4 text-muted">
              {jobs.length} open {jobs.length === 1 ? 'job' : 'jobs'}
            </p>
          )}

          {jobs?.length === 0 && (
            <Empty
              title="No jobs match your filters"
              body={
                role === 'CLIENT'
                  ? 'Try clearing filters, or post the first job yourself.'
                  : 'Try clearing filters or widening your search.'
              }
              action={
                role === 'CLIENT' ? (
                  <Link href="/jobs/new" className="btn-primary">
                    Post a job
                  </Link>
                ) : null
              }
            />
          )}

          <ul className="flex flex-col gap-4">
            {jobs?.map((job) => (
              <Card key={job.id} as="li" hover className="p-0">
                <Link href={`/jobs/${job.id}`} className="block p-6">
                  {/* Stacked below sm: side-by-side squeezes the title into a
                      three-word-per-line sliver on a phone. */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="min-w-0 sm:order-1">
                      <h3 className="text-xl font-semibold leading-snug text-balance">
                        {job.title}
                      </h3>
                      <p className="mt-1 text-sm text-muted">
                        <span className="capitalize">{job.category.replace(/-/g, ' ')}</span> ·
                        posted {ago(job.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 sm:order-2 sm:text-right">
                      <p className="text-2xl font-semibold tabular-nums">
                        {money(job.budgetCents)}
                      </p>
                      <p className="text-sm text-muted">fixed budget</p>
                    </div>
                  </div>

                  <p className="mt-4 line-clamp-3 leading-relaxed text-muted">{job.description}</p>

                  {job.skills.length > 0 && (
                    <ul className="mt-5 flex flex-wrap gap-2">
                      {job.skills.map((s) => (
                        <li key={s}>
                          <Pill>{s}</Pill>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                    <Avatar name={job.clientName} src={job.clientAvatarUrl ? API_BASE + job.clientAvatarUrl : null} size="sm" />
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium">{job.clientName}</p>
                      <p className="text-muted">
                        {job.proposalCount} proposal{job.proposalCount === 1 ? '' : 's'} so far
                      </p>
                    </div>
                  </div>
                </Link>
              </Card>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-2 text-left transition-colors ${
        active ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
