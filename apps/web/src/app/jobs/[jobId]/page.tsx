'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProposalDto } from '@trustlance/shared-types';
import { API_BASE, ApiClientError, apiRequest } from '@/lib/api';
import { money, useJob, useJobProposals } from '@/lib/hooks';
import { useAuthStore } from '@/stores/auth';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Empty,
  Field,
  FormError,
  Pill,
  Spinner,
  TextareaField,
} from '@/components/ui';

export default function JobDetailPage() {
  const jobId = String(useParams().jobId);
  const { user } = useAuthStore();
  const { data: job, isLoading } = useJob(jobId);

  const isOwner = user?.id === job?.clientId;
  const { data: proposals } = useJobProposals(jobId, Boolean(isOwner));

  if (isLoading) return <Spinner />;
  if (!job) return <div className="container-mid py-16"><Empty title="Job not found" /></div>;

  return (
    <div className="container-wide py-10">
      <Link href="/jobs" className="text-muted hover:text-foreground">
        ← All jobs
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_20rem]">
        {/* --------------------------------------------------------- main --- */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Pill>
              <span className="capitalize">{job.category.replace(/-/g, ' ')}</span>
            </Pill>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
                job.status === 'OPEN' ? 'bg-success-bg text-success' : 'bg-surface-3 text-muted'
              }`}
            >
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {job.status === 'OPEN' ? 'Open for proposals' : 'Closed'}
            </span>
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {job.title}
          </h1>

          <p className="mt-6 whitespace-pre-wrap text-lg leading-relaxed">{job.description}</p>

          {job.skills.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Skills required
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {job.skills.map((s) => (
                  <li key={s}>
                    <Pill>{s}</Pill>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <hr className="my-10 border-border" />

          {isOwner ? (
            <ProposalReview jobId={jobId} proposals={proposals} />
          ) : user?.role === 'FREELANCER' ? (
            job.status === 'OPEN' ? (
              <SubmitProposal jobId={jobId} budgetCents={job.budgetCents} />
            ) : (
              <Banner tone="warning">This job is closed and no longer accepting proposals.</Banner>
            )
          ) : !user ? (
            <Banner tone="accent" title="Want to bid on this?">
              <Link href="/login" className="link">
                Log in
              </Link>{' '}
              as a freelancer to submit a proposal.
            </Banner>
          ) : (
            <Banner tone="info">
              You’re signed in as a client, so you can’t bid on jobs.
            </Banner>
          )}
        </div>

        {/* -------------------------------------------------------- sidebar -- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted">Budget</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">{money(job.budgetCents)}</p>
            <p className="mt-1 text-sm text-muted">Fixed price, paid by milestone</p>

            <hr className="my-6 border-border" />

            <p className="text-sm font-semibold uppercase tracking-wider text-muted">Posted by</p>
            <Link
              href={`/u/${job.clientId}`}
              className="mt-3 flex items-center gap-3 rounded-lg p-2 -m-2 transition-colors hover:bg-surface-2"
            >
              <Avatar name={job.clientName} src={job.clientAvatarUrl ? API_BASE + job.clientAvatarUrl : null} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{job.clientName}</span>
                <span className="block text-sm text-muted">View trust profile →</span>
              </span>
            </Link>

            <hr className="my-6 border-border" />

            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Proposals</dt>
                <dd className="font-medium tabular-nums">{job.proposalCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Posted</dt>
                <dd className="font-medium">{new Date(job.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </Card>

          <div className="mt-4 rounded-2xl bg-surface-2 p-5 text-sm text-muted">
            <p className="font-medium text-foreground">Protected by escrow</p>
            <p className="mt-2 leading-relaxed">
              Funds are locked per milestone and released only on approval. Either party can open a
              dispute, and an arbitrator rules on the attached evidence.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SubmitProposal({ jobId, budgetCents }: { jobId: string; budgetCents: number }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await apiRequest(`/api/jobs/${jobId}/proposals`, {
        method: 'POST',
        body: {
          coverLetter: String(form.get('coverLetter')),
          amountCents: Math.round(Number(form.get('amount')) * 100),
        },
      });
      setDone(true);
      void qc.invalidateQueries({ queryKey: ['job', jobId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not submit.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Banner tone="success" title="Proposal submitted">
        The client has been notified. You’ll get a notification when they respond.
      </Banner>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Submit a proposal</h2>
        <p className="mt-2 text-muted">
          One proposal per job. Be specific about your approach — clients see your trust score
          alongside this.
        </p>
      </div>
      <TextareaField
        label="Cover letter"
        name="coverLetter"
        rows={7}
        required
        placeholder="Why you’re a good fit, and how you’d approach it."
        hint="At least 20 characters."
      />
      <div className="sm:max-w-56">
        <Field
          label="Your bid"
          name="amount"
          type="number"
          step="0.01"
          min="1"
          required
          prefix="$"
          defaultValue={(budgetCents / 100).toFixed(2)}
        />
      </div>
      <FormError message={error} />
      <Button type="submit" loading={loading} size="lg" className="sm:self-start">
        Submit proposal
      </Button>
    </form>
  );
}

/** Client-side review + the milestone wizard shown on accept. */
function ProposalReview({ jobId, proposals }: { jobId: string; proposals: ProposalDto[] | undefined }) {
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const qc = useQueryClient();

  async function reject(id: string) {
    await apiRequest(`/api/proposals/${id}/reject`, { method: 'POST' });
    void qc.invalidateQueries({ queryKey: ['proposals', jobId] });
  }

  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-tight">
        Proposals{' '}
        <span className="font-normal text-muted">({proposals?.length ?? 0})</span>
      </h2>

      {proposals?.length === 0 && (
        <div className="mt-5">
          <Empty title="No proposals yet" body="Freelancers will appear here as they apply." />
        </div>
      )}

      <div className="mt-5 flex flex-col gap-4">
        {proposals?.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 gap-4">
                <Avatar name={p.freelancerName} src={p.freelancerAvatarUrl ? API_BASE + p.freelancerAvatarUrl : null} />
                <div className="min-w-0">
                  <Link href={`/u/${p.freelancerId}`} className="text-lg font-semibold hover:underline">
                    {p.freelancerName}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted">
                    Trust score:{' '}
                    {p.freelancerTrustScore == null ? (
                      'no history yet'
                    ) : (
                      <span className="font-medium text-accent">
                        {p.freelancerTrustScore.toFixed(1)}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums">{money(p.amountCents)}</p>
                <p className="text-sm text-muted">their bid</p>
              </div>
            </div>

            <p className="mt-5 whitespace-pre-wrap leading-relaxed">{p.coverLetter}</p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {p.status === 'PENDING' ? (
                <>
                  <Button onClick={() => setAcceptingId(p.id)}>Accept &amp; set milestones</Button>
                  <Button variant="ghost" onClick={() => void reject(p.id)}>
                    Decline
                  </Button>
                </>
              ) : (
                <Pill>
                  <span className="capitalize">{p.status.toLowerCase()}</span>
                </Pill>
              )}
            </div>

            {acceptingId === p.id && (
              <MilestoneWizard
                proposalId={p.id}
                totalCents={p.amountCents}
                onCancel={() => setAcceptingId(null)}
              />
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}

interface Draft {
  title: string;
  amount: string;
  dueDate: string;
}

/**
 * Splits the agreed amount into milestones.
 *
 * Enforces that the parts sum to the bid *before* submitting: the server would
 * accept any total, but silently changing the price the freelancer agreed to
 * would be a trust bug, not a validation one.
 */
function MilestoneWizard({
  proposalId,
  totalCents,
  onCancel,
}: {
  proposalId: string;
  totalCents: number;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>([
    { title: 'Milestone 1', amount: (totalCents / 100).toFixed(2), dueDate: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sumCents = rows.reduce((s, r) => s + Math.round(Number(r.amount || 0) * 100), 0);
  const balanced = sumCents === totalCents;

  function update(i: number, patch: Partial<Draft>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ contractId: string }>(`/api/proposals/${proposalId}/accept`, {
        method: 'POST',
        body: {
          milestones: rows.map((r) => ({
            title: r.title,
            amountCents: Math.round(Number(r.amount) * 100),
            ...(r.dueDate ? { dueDate: new Date(r.dueDate).toISOString() } : {}),
          })),
        },
      });
      router.push(`/contracts/${res.contractId}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not create the contract.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-accent bg-accent-soft/40 p-6">
      <h3 className="text-lg font-semibold">Define milestones</h3>
      <p className="mt-1 text-muted">
        You fund each milestone separately. Money only moves when you approve the work.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Field
                label={`Milestone ${i + 1}`}
                value={r.title}
                onChange={(e) => update(i, { title: e.target.value })}
                name={`title-${i}`}
              />
            </div>
            <div className="w-36">
              <Field
                label="Amount"
                type="number"
                step="0.01"
                min="0.01"
                prefix="$"
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                name={`amount-${i}`}
              />
            </div>
            <div className="w-44">
              <Field
                label="Due (optional)"
                type="date"
                value={r.dueDate}
                onChange={(e) => update(i, { dueDate: e.target.value })}
                name={`due-${i}`}
              />
            </div>
            {rows.length > 1 && (
              <Button
                variant="ghost"
                onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                aria-label={`Remove milestone ${i + 1}`}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { title: `Milestone ${rs.length + 1}`, amount: '0.00', dueDate: '' },
            ])
          }
        >
          + Add milestone
        </Button>
        <p className={`font-medium tabular-nums ${balanced ? 'text-accent' : 'text-danger'}`}>
          {money(sumCents)} of {money(totalCents)}
          {!balanced && <span className="font-normal"> — must match the agreed bid</span>}
        </p>
      </div>

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => void submit()} loading={loading} disabled={!balanced}>
          Create contract
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
