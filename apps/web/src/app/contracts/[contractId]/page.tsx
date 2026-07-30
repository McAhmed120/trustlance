'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import type { MilestoneDto } from '@trustlance/shared-types';
import { ApiClientError } from '@/lib/api';
import { money, useContract, useContractRealtime, useMilestoneAction } from '@/lib/hooks';
import { useAuthStore } from '@/stores/auth';
import { RequireRole } from '@/components/require-role';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Empty,
  FormError,
  MilestoneProgress,
  Spinner,
  StateBadge,
} from '@/components/ui';
import { ChatPanel } from '@/components/chat-panel';
import { TimeTracker } from '@/components/time-tracker';
import { FilePanel } from '@/components/file-panel';

export default function ContractPage() {
  return (
    <RequireRole>
      <ContractWorkspace />
    </RequireRole>
  );
}

function ContractWorkspace() {
  const contractId = String(useParams().contractId);
  const { user } = useAuthStore();
  const { data: contract, isLoading } = useContract(contractId);

  // Live updates: the counterparty must see a state change immediately.
  useContractRealtime(contractId);

  const [tab, setTab] = useState<'milestones' | 'chat' | 'time' | 'files'>('milestones');

  if (isLoading) return <Spinner label="Loading contract…" />;
  if (!contract)
    return (
      <div className="container-mid py-16">
        <Empty title="Contract not found" />
      </div>
    );

  const isClient = user?.id === contract.clientId;
  const counterparty = isClient ? contract.freelancerName : contract.clientName;
  const counterpartyId = isClient ? contract.freelancerId : contract.clientId;

  const released = contract.milestones
    .filter((m) => ['RELEASED', 'RESOLVED'].includes(m.state))
    .reduce((s, m) => s + m.amountCents, 0);
  const inEscrow = contract.milestones.reduce((s, m) => s + m.escrowCents, 0);

  const tabs = [
    { key: 'milestones' as const, label: 'Milestones', count: contract.milestones.length },
    { key: 'chat' as const, label: 'Chat' },
    { key: 'time' as const, label: 'Time' },
    { key: 'files' as const, label: 'Files' },
  ];

  return (
    <div className="container-wide py-10">
      <Link href="/dashboard" className="text-muted hover:text-foreground">
        ← Dashboard
      </Link>

      {/* ------------------------------------------------------------ header -- */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {contract.jobTitle}
          </h1>
          <Link
            href={`/u/${counterpartyId}`}
            className="mt-4 inline-flex items-center gap-3 rounded-lg p-2 -m-2 transition-colors hover:bg-surface-2"
          >
            <Avatar name={counterparty} size="sm" />
            <span>
              <span className="block text-sm text-muted">
                {isClient ? 'Freelancer' : 'Client'}
              </span>
              <span className="block font-medium">{counterparty}</span>
            </span>
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-x-8 gap-y-2 rounded-2xl border border-border bg-surface p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(contract.totalAmountCents)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">In escrow</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-info">{money(inEscrow)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Released</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-accent">{money(released)}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 max-w-md">
        <MilestoneProgress states={contract.milestones.map((m) => m.state)} />
      </div>

      {contract.status === 'COMPLETED' && (
        <div className="mt-6">
          <Banner tone="success" title="Contract complete">
            Signed work records were issued for every released milestone.
          </Banner>
        </div>
      )}

      {/* -------------------------------------------------------------- tabs -- */}
      <div role="tablist" aria-label="Contract sections" className="mt-8 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-5 py-3 transition-colors ${
              tab === t.key
                ? 'border-accent font-medium text-foreground'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs tabular-nums">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === 'milestones' && (
          <div className="flex flex-col gap-5">
            {contract.milestones.map((m, i) => (
              <MilestoneCard
                key={m.id}
                milestone={m}
                index={i}
                contractId={contractId}
                isClient={isClient}
              />
            ))}
          </div>
        )}
        {tab === 'chat' && <ChatPanel contractId={contractId} />}
        {tab === 'time' && <TimeTracker contractId={contractId} canLog={!isClient} />}
        {tab === 'files' && <FilePanel contractId={contractId} />}
      </div>
    </div>
  );
}

/**
 * One milestone with its state-appropriate actions.
 *
 * The action set is derived from state, so the UI can never offer a transition
 * the server would reject — the state machine is the single source of truth for
 * what's possible, mirrored here rather than reinvented.
 */
function MilestoneCard({
  milestone: m,
  index,
  contractId,
  isClient,
}: {
  milestone: MilestoneDto;
  index: number;
  contractId: string;
  isClient: boolean;
}) {
  const action = useMilestoneAction(contractId);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<null | 'submit' | 'changes' | 'dispute' | 'approve'>(null);
  const [text, setText] = useState('');
  const [rating, setRating] = useState(5);

  async function run(act: string, body?: unknown) {
    setError(null);
    try {
      await action.mutateAsync({ id: m.id, action: act, body });
      setPrompt(null);
      setText('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Action failed.');
    }
  }

  const busy = action.isPending;
  const terminal = ['RELEASED', 'RESOLVED', 'CANCELLED'].includes(m.state);

  return (
    <Card className={terminal ? 'opacity-90' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <span
            aria-hidden
            className={`grid size-10 shrink-0 place-items-center rounded-full font-semibold ${
              ['RELEASED', 'RESOLVED'].includes(m.state)
                ? 'bg-accent text-accent-fg'
                : 'bg-surface-3 text-muted'
            }`}
          >
            {['RELEASED', 'RESOLVED'].includes(m.state) ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              index + 1
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold leading-snug">{m.title}</h3>
            {m.description && <p className="mt-1 text-muted">{m.description}</p>}
            {m.dueDate && (
              <p className="mt-1 text-sm text-muted">
                Due {new Date(m.dueDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-semibold tabular-nums">{money(m.amountCents)}</p>
          <div className="mt-2 flex justify-end">
            <StateBadge state={m.state} />
          </div>
        </div>
      </div>

      {m.escrowCents > 0 && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-lg bg-info-bg px-3 py-2 text-sm font-medium text-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {money(m.escrowCents)} held in escrow
        </p>
      )}

      {m.submissionNote && (
        <div className="mt-5 rounded-xl bg-surface-2 p-4">
          <p className="text-sm font-semibold text-muted">Freelancer’s submission</p>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{m.submissionNote}</p>
        </div>
      )}

      {m.state === 'SUBMITTED' && m.autoReleaseAt && (
        <p className="mt-4 text-sm text-warning">
          Auto-releases {new Date(m.autoReleaseAt).toLocaleString()} if not reviewed.
        </p>
      )}

      {m.feedback && m.state === 'IN_PROGRESS' && (
        <div className="mt-5 rounded-xl bg-warning-bg p-4 text-warning">
          <p className="text-sm font-semibold">Changes requested</p>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{m.feedback}</p>
        </div>
      )}

      {m.openDispute && (
        <div className="mt-5 rounded-xl bg-danger-bg p-4 text-danger">
          <p className="text-sm font-semibold">Dispute open — escrow frozen pending arbitration</p>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{m.openDispute.reason}</p>
        </div>
      )}

      {m.state === 'RELEASED' && m.rating && (
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-accent">
          <span aria-hidden>{'★'.repeat(m.rating)}</span>
          Rated {m.rating}/5 · signed work record issued
        </p>
      )}

      <FormError message={error} />

      {/* --------------------------------------------------- inline prompts -- */}
      {prompt && prompt !== 'approve' && (
        <div className="mt-5 flex flex-col gap-3 rounded-xl bg-surface-2 p-4">
          <label htmlFor={`note-${m.id}`} className="text-sm font-semibold">
            {prompt === 'submit'
              ? 'Describe what you delivered'
              : prompt === 'changes'
                ? 'What needs to change?'
                : 'Why are you disputing this milestone?'}
          </label>
          <textarea
            id={`note-${m.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="input"
            placeholder={
              prompt === 'submit'
                ? 'What did you deliver? Link the work.'
                : prompt === 'changes'
                  ? 'Be specific — this is recorded as evidence.'
                  : 'Be specific — an arbitrator will read this.'
            }
            aria-label="Note"
          />
          <div className="flex flex-wrap gap-3">
            <Button
              loading={busy}
              disabled={text.trim().length < 10}
              onClick={() =>
                void run(
                  prompt === 'submit' ? 'submit' : prompt === 'changes' ? 'request-changes' : 'dispute',
                  prompt === 'dispute' ? { reason: text } : { note: text },
                )
              }
            >
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {prompt === 'approve' && (
        <div className="mt-5 flex flex-col gap-4 rounded-xl border border-accent bg-accent-soft/40 p-5">
          <div>
            <p className="text-lg font-semibold">Approve and release {money(m.amountCents)}?</p>
            <p className="mt-1 text-muted">
              This releases escrow to the freelancer and issues a signed work record. It cannot be
              undone.
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">Rate this work</legend>
            <div className="mt-2 flex gap-2">
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRating(r)}
                  aria-pressed={rating === r}
                  aria-label={`${r} out of 5`}
                  className={`grid size-11 place-items-center rounded-full border-2 text-lg transition-colors ${
                    r <= rating
                      ? 'border-accent bg-accent text-accent-fg'
                      : 'border-border text-muted hover:border-border-strong'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <Button loading={busy} onClick={() => void run('approve', { rating })}>
              Release payment
            </Button>
            <Button variant="ghost" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ----------------------------------------- state-derived action set -- */}
      {!prompt && !terminal && (
        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          {isClient && m.state === 'CREATED' && (
            <>
              <Button loading={busy} onClick={() => void run('fund')}>
                Fund escrow
              </Button>
              <Button variant="ghost" loading={busy} onClick={() => void run('cancel')}>
                Cancel
              </Button>
            </>
          )}
          {!isClient && m.state === 'FUNDED' && (
            <Button loading={busy} onClick={() => void run('start')}>
              Start work
            </Button>
          )}
          {!isClient && m.state === 'IN_PROGRESS' && (
            <Button onClick={() => setPrompt('submit')}>Submit deliverable</Button>
          )}
          {isClient && m.state === 'SUBMITTED' && (
            <>
              <Button onClick={() => setPrompt('approve')}>Approve &amp; release</Button>
              <Button variant="ghost" onClick={() => setPrompt('changes')}>
                Request changes
              </Button>
            </>
          )}
          {/* Either party may dispute anything with money committed (§9). */}
          {['FUNDED', 'IN_PROGRESS', 'SUBMITTED'].includes(m.state) && (
            <Button variant="danger" onClick={() => setPrompt('dispute')}>
              Raise dispute
            </Button>
          )}
          {isClient && m.state === 'FUNDED' && (
            <Button variant="ghost" loading={busy} onClick={() => void run('cancel')}>
              Cancel &amp; refund
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
