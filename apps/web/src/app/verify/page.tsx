'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { WorkRecordClaims } from '@trustlance/shared-types';
import { API_BASE } from '@/lib/api';
import { money } from '@/lib/hooks';
import { Banner, Button, Card } from '@/components/ui';

interface VerifyResult {
  valid: boolean;
  keyId?: string;
  claims?: WorkRecordClaims;
}

/**
 * Public, no-login verifier (Sprint 4 Day 20 + §14 stretch goal).
 *
 * Deliberately requires no account and reads no user data: paste a record, get
 * a verdict. This page is the demonstration that a TrustLance work record is
 * worth something outside TrustLance.
 */
export default function VerifyPage() {
  const [jws, setJws] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(input: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/reputation/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jws: input.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Verification request failed');
      }
      setResult((await res.json()) as VerifyResult);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /** Accepts either a bare JWS or a full exported bundle. */
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = jws.trim();
    if (!text) return;
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as { records?: string[] };
        const first = parsed.records?.[0];
        if (first) {
          void verify(first);
          return;
        }
        setError('That JSON has no "records" array.');
        return;
      } catch {
        setError('That looks like JSON but could not be parsed.');
        return;
      }
    }
    void verify(text);
  }

  return (
    <div className="container-mid py-12">
      <div className="text-center">
        <span
          aria-hidden
          className="inline-grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6l7-4z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
          Verify a work record
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-lg text-muted text-pretty">
          Paste a signed record — or a whole exported bundle — to check it against the platform’s
          public key.
        </p>
      </div>

      <div className="mt-8">
        <Banner tone="accent">
          No account needed. Verification uses only the Ed25519 public key, so a record stays
          provable even if TrustLance disappears.
        </Banner>
      </div>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <label htmlFor="jws" className="label">
          Signed record (JWS) or exported bundle
        </label>
        <textarea
          id="jws"
          value={jws}
          onChange={(e) => setJws(e.target.value)}
          rows={7}
          placeholder="eyJhbGciOiJFZERTQSIsImtpZCI6..."
          className="input font-mono text-sm"
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={loading} disabled={!jws.trim()} size="lg">
            Verify record
          </Button>
          {result && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => {
                setJws('');
                setResult(null);
                setError(null);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </form>

      {error && (
        <div className="mt-8">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {result && !result.valid && (
        <div className="mt-8">
          <Banner tone="danger" title="Not valid">
            The signature doesn’t match, meaning this record was not issued by TrustLance or has been
            altered since.
          </Banner>
        </div>
      )}

      {result?.valid && result.claims && (
        <div className="mt-8 flex flex-col gap-6">
          <div className="flex items-start gap-4 rounded-2xl bg-success-bg p-6 text-success">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-white">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <div>
              <p className="text-lg font-semibold">Valid signature</p>
              <p className="mt-1">
                Signed by TrustLance with key{' '}
                <code className="font-mono text-sm">{result.keyId}</code>.
              </p>
            </div>
          </div>

          <Card>
            <h2 className="text-2xl font-semibold tracking-tight">{result.claims.title}</h2>
            <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-semibold uppercase tracking-wider text-muted">Amount</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {money(result.claims.amountCents)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-semibold uppercase tracking-wider text-muted">Rating</dt>
                <dd className="mt-1 text-2xl font-semibold">
                  {result.claims.rating == null ? (
                    <span className="text-base font-normal text-muted">
                      Not rated (auto-released)
                    </span>
                  ) : (
                    <>
                      <span aria-hidden className="text-accent">
                        {'★'.repeat(result.claims.rating)}
                      </span>{' '}
                      <span className="tabular-nums">{result.claims.rating}/5</span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-semibold uppercase tracking-wider text-muted">
                  Completed
                </dt>
                <dd className="mt-1">{new Date(result.claims.completedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold uppercase tracking-wider text-muted">
                  Freelancer
                </dt>
                <dd className="mt-1">
                  <Link href={`/u/${result.claims.freelancerId}`} className="link font-mono text-sm break-all">
                    {result.claims.freelancerId}
                  </Link>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm font-semibold uppercase tracking-wider text-muted">Client</dt>
                <dd className="mt-1 font-mono text-sm break-all text-muted">
                  {result.claims.clientId}
                </dd>
              </div>
            </dl>
          </Card>

          <p className="text-sm leading-relaxed text-muted">
            This check proves the record is authentic and unmodified. It does not prove the client’s
            identity — that would need the client’s own signature, a Phase 2 addition.
          </p>
        </div>
      )}
    </div>
  );
}
