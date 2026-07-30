'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { useTimeEntries } from '@/lib/hooks';
import { Button, Card, Empty, Spinner } from './ui';

function hhmmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/**
 * Tamper-evident time tracking (§10.4).
 *
 * The timer runs in the browser; a *completed* interval is posted on stop.
 * Entries are append-only, so nothing is ever edited and the hash chain stays
 * intact by construction. The "chain verified" indicator re-verifies on every
 * fetch, so DB-level tampering shows up here immediately.
 */
export function TimeTracker({ contractId, canLog }: { contractId: string; canLog: boolean }) {
  const { data, isLoading } = useTimeEntries(contractId);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // 0 until a timer starts. Reading Date.now() during render is impure and
  // would make the initial value depend on when React happened to render.
  const [now, setNow] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  async function stop() {
    if (startedAt === null) return;
    setSaving(true);
    try {
      await apiRequest(`/api/contracts/${contractId}/time`, {
        method: 'POST',
        body: {
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setStartedAt(null);
      setNote('');
    } finally {
      setSaving(false);
    }
  }

  const totalMs =
    data?.entries.reduce(
      (sum, e) =>
        sum + (e.endedAt ? new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime() : 0),
      0,
    ) ?? 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* Chain status is the headline: it's the whole point of this feature. */}
      {data && (
        <div
          className={`flex items-start gap-4 rounded-2xl p-5 ${
            data.chainValid ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
          }`}
        >
          <span
            aria-hidden
            className={`grid size-10 shrink-0 place-items-center rounded-full ${
              data.chainValid ? 'bg-success' : 'bg-danger'
            } text-white`}
          >
            {data.chainValid ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            )}
          </span>
          <div>
            <p className="font-semibold">
              {data.chainValid ? 'Hash chain verified' : 'Hash chain broken'}
            </p>
            <p className="mt-1">
              {data.chainValid
                ? 'No time entry has been altered since it was logged.'
                : 'An entry was modified or deleted after the fact — this log can no longer be trusted.'}
            </p>
          </div>
        </div>
      )}

      {canLog && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-muted">Timer</p>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums">
                {startedAt === null ? '00:00:00' : hhmmss(now - startedAt)}
              </p>
            </div>
            {startedAt === null ? (
              <Button
                size="lg"
                onClick={() => {
                  setStartedAt(Date.now());
                  setNow(Date.now());
                }}
              >
                Start timer
              </Button>
            ) : (
              <Button variant="danger" size="lg" loading={saving} onClick={() => void stop()}>
                Stop &amp; log
              </Button>
            )}
          </div>
          {startedAt !== null && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What are you working on? (optional)"
              aria-label="Time entry note"
              className="input mt-5"
            />
          )}
        </Card>
      )}

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h3 className="text-xl font-semibold tracking-tight">Logged time</h3>
          <span className="font-mono text-lg tabular-nums text-muted">{hhmmss(totalMs)} total</span>
        </div>

        {isLoading && <Spinner />}
        {data?.entries.length === 0 && (
          <div className="mt-4">
            <Empty
              title="No time logged yet"
              body={canLog ? 'Start the timer to log your first session.' : undefined}
            />
          </div>
        )}

        <ul className="mt-4 flex flex-col gap-3">
          {data?.entries.map((e) => (
            <Card key={e.id} as="li" className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p>
                  {new Date(e.startedAt).toLocaleString()}
                  {e.note && <span className="text-muted"> — {e.note}</span>}
                </p>
                {/* Showing the hash prefixes makes the chain tangible rather
                    than an invisible claim. */}
                <p className="mt-1 font-mono text-xs text-muted">
                  {e.prevHash.slice(0, 10)} → {e.hash.slice(0, 10)}
                </p>
              </div>
              <span className="shrink-0 font-mono text-lg tabular-nums">
                {e.endedAt
                  ? hhmmss(new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime())
                  : '—'}
              </span>
            </Card>
          ))}
        </ul>
      </div>
    </div>
  );
}
