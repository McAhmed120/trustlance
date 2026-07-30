'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, apiRequest } from '@/lib/api';
import { money } from '@/lib/hooks';
import { RequireRole } from '@/components/require-role';
import {
  Banner,
  Button,
  Card,
  Empty,
  FormError,
  Spinner,
  TextareaField,
} from '@/components/ui';

interface DisputeRow {
  id: string;
  reason: string;
  raisedById: string;
  createdAt: string;
  milestone: {
    id: string;
    title: string;
    amountCents: number;
    state: string;
    contractId: string;
    jobTitle: string;
    clientId: string;
    freelancerId: string;
  };
}

interface Bundle extends DisputeRow {
  milestone: DisputeRow['milestone'] & {
    escrowCents: number;
    submissionNote: string | null;
    description: string | null;
  };
  evidence: {
    messages: { senderId: string; body: string; at: string }[];
    files: { id: string; filename: string; version: number; sizeBytes: number }[];
    timeEntries: { startedAt: string; endedAt: string | null; note: string | null }[];
  };
}

export default function AdminDisputesPage() {
  return (
    <RequireRole role="ADMIN">
      <DisputeQueue />
    </RequireRole>
  );
}

function DisputeQueue() {
  const { data: disputes, isLoading } = useQuery({
    queryKey: ['disputes'],
    queryFn: () => apiRequest<DisputeRow[]>('/api/disputes'),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  /*
   * Confirmation has to live here, not inside DisputeDetail. Resolving removes
   * the dispute from the OPEN queue, so refetching unmounts the row — and with
   * it any success message rendered inside it. The arbitrator would watch the
   * dispute silently vanish with no evidence their ruling landed.
   */
  const [resolvedNote, setResolvedNote] = useState<string | null>(null);

  return (
    <div className="container-wide py-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Dispute queue</h1>
          <p className="mt-2 text-lg text-muted">
            Rule on evidence: chat, files, and time logs are attached automatically.
          </p>
        </div>
        {disputes && disputes.length > 0 && (
          <span className="rounded-full bg-danger-bg px-4 py-2 font-medium text-danger">
            {disputes.length} awaiting ruling
          </span>
        )}
      </div>

      {resolvedNote && (
        <div className="mt-6">
          <Banner tone="success" title="Ruling recorded">
            {resolvedNote}
          </Banner>
        </div>
      )}

      {isLoading && <Spinner label="Loading disputes…" />}

      {disputes?.length === 0 && (
        <div className="mt-8">
          <Empty title="No open disputes" body="Escrow is flowing normally across all contracts." />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-5">
        {disputes?.map((d) => (
          <Card key={d.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted">{d.milestone.jobTitle}</p>
                <h2 className="mt-1 text-xl font-semibold">{d.milestone.title}</h2>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-semibold tabular-nums">
                  {money(d.milestone.amountCents)}
                </p>
                <p className="text-sm text-muted">in contention</p>
              </div>
            </div>

            <div className="mt-5 rounded-xl bg-danger-bg p-4 text-danger">
              <p className="text-sm font-semibold">
                Raised by {d.raisedById === d.milestone.clientId ? 'the client' : 'the freelancer'} ·{' '}
                {new Date(d.createdAt).toLocaleString()}
              </p>
              <p className="mt-2 whitespace-pre-wrap leading-relaxed">{d.reason}</p>
            </div>

            <div className="mt-5">
              {openId === d.id ? (
                <DisputeDetail
                  disputeId={d.id}
                  onClose={() => setOpenId(null)}
                  onResolved={(pct) => {
                    setResolvedNote(
                      `“${d.milestone.title}”: ${pct}% released to the freelancer, ${100 - pct}% refunded to the client. Both parties were notified.`,
                    );
                    setOpenId(null);
                  }}
                />
              ) : (
                <Button onClick={() => setOpenId(d.id)}>Review evidence &amp; rule</Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DisputeDetail({
  disputeId,
  onClose,
  onResolved,
}: {
  disputeId: string;
  onClose: () => void;
  onResolved: (pct: number) => void;
}) {
  const qc = useQueryClient();
  const { data: bundle, isLoading } = useQuery({
    queryKey: ['dispute', disputeId],
    queryFn: () => apiRequest<Bundle>(`/api/disputes/${disputeId}`),
  });

  const [pct, setPct] = useState(50);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/disputes/${disputeId}/resolve`, {
        method: 'POST',
        body: { freelancerPct: pct, note },
      });
      // Tell the parent first: invalidating drops this dispute out of the OPEN
      // queue and unmounts this component, so the confirmation must already
      // live somewhere that survives.
      onResolved(pct);
      void qc.invalidateQueries({ queryKey: ['disputes'] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not resolve.');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Spinner label="Loading evidence…" />;
  if (!bundle) return <Banner tone="danger">Could not load the evidence bundle.</Banner>;

  const escrow = bundle.milestone.escrowCents;
  const toFreelancer = Math.round((escrow * pct) / 100);

  return (
    <div className="flex flex-col gap-7 rounded-2xl border border-border bg-surface-2 p-6">
      {/* ------------------------------------------------------- evidence -- */}
      <div>
        <h3 className="text-lg font-semibold">Evidence</h3>
        <p className="mt-1 text-muted">
          <span className="font-medium tabular-nums text-info">{money(escrow)}</span> currently held
          in escrow.
        </p>
      </div>

      {bundle.milestone.submissionNote && (
        <div className="rounded-xl bg-surface p-4">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted">
            Freelancer’s submission
          </p>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">
            {bundle.milestone.submissionNote}
          </p>
        </div>
      )}

      <div className="rounded-xl bg-surface p-4">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted">
          Chat ({bundle.evidence.messages.length} messages)
        </p>
        <div className="mt-3 flex max-h-56 flex-col gap-3 overflow-y-auto">
          {bundle.evidence.messages.map((m, i) => (
            <div key={i}>
              <p className="text-sm font-medium">
                {m.senderId === bundle.milestone.clientId ? 'Client' : 'Freelancer'}
                <span className="ml-2 font-normal text-muted">
                  {new Date(m.at).toLocaleString()}
                </span>
              </p>
              <p className="mt-0.5">{m.body}</p>
            </div>
          ))}
          {bundle.evidence.messages.length === 0 && <p className="text-muted">No messages.</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-surface p-4">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted">
            Files ({bundle.evidence.files.length})
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {bundle.evidence.files.map((f) => (
              <li key={f.id} className="truncate">
                {f.filename} <span className="text-muted">(v{f.version})</span>
              </li>
            ))}
            {bundle.evidence.files.length === 0 && <li className="text-muted">None shared.</li>}
          </ul>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted">
            Time entries ({bundle.evidence.timeEntries.length})
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {bundle.evidence.timeEntries.slice(0, 6).map((t, i) => (
              <li key={i} className="truncate">
                {new Date(t.startedAt).toLocaleDateString()}
                {t.note && <span className="text-muted"> — {t.note}</span>}
              </li>
            ))}
            {bundle.evidence.timeEntries.length === 0 && (
              <li className="text-muted">None logged.</li>
            )}
          </ul>
        </div>
      </div>

      {/* --------------------------------------------------------- ruling -- */}
      <div className="border-t border-border pt-6">
        <h3 className="text-lg font-semibold">Ruling</h3>

        <div className="mt-4">
          <label htmlFor="pct" className="text-sm font-semibold uppercase tracking-wider text-muted">
            Split escrow
          </label>
          <input
            id="pct"
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="mt-3 w-full accent-[var(--accent)]"
          />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-success-bg p-4">
              <p className="text-sm font-medium text-success">Freelancer receives</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-success">
                {money(toFreelancer)}
              </p>
              <p className="text-sm text-success">{pct}% of escrow</p>
            </div>
            <div className="rounded-xl bg-surface p-4">
              <p className="text-sm font-medium text-muted">Client refunded</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {money(escrow - toFreelancer)}
              </p>
              <p className="text-sm text-muted">{100 - pct}% of escrow</p>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <TextareaField
            label="Reasoning (recorded permanently)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            name="note"
            hint="Both parties see this. At least 10 characters."
            error={note.length > 0 && note.length < 10 ? 'At least 10 characters' : undefined}
          />
        </div>

        <FormError message={error} />

        <div className="mt-6 flex flex-wrap gap-3">
          <Button loading={saving} disabled={note.trim().length < 10} onClick={() => void resolve()}>
            Issue ruling &amp; move funds
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
