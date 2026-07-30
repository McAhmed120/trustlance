'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError, apiRequest } from '@/lib/api';
import { money, useWallet } from '@/lib/hooks';
import { RequireRole } from '@/components/require-role';
import { Banner, Button, Card, Empty, Field, FormError, Spinner, Stat } from '@/components/ui';

export default function WalletPage() {
  return (
    <RequireRole>
      <Wallet />
    </RequireRole>
  );
}

const LEDGER_META: Record<string, { label: string; description: string; tone: string }> = {
  DEPOSIT: { label: 'Deposit', description: 'Demo funds added', tone: 'text-accent' },
  FUND: { label: 'Escrow funded', description: 'Locked against a milestone', tone: 'text-muted' },
  RELEASE: { label: 'Payment released', description: 'Escrow paid out', tone: 'text-accent' },
  REFUND: { label: 'Refund', description: 'Escrow returned', tone: 'text-accent' },
};

function Wallet() {
  const { data: wallet, isLoading } = useWallet();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('500.00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function topUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiRequest('/api/wallet/deposit', {
        method: 'POST',
        body: { amountCents: Math.round(Number(amount) * 100) },
      });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Top-up failed.');
    } finally {
      setLoading(false);
    }
  }

  if (isLoading) return <Spinner label="Loading wallet…" />;

  return (
    <div className="container-wide py-10">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Wallet</h1>
      <p className="mt-2 text-lg text-muted">
        Every figure here is summed from the append-only ledger — there is no stored balance to drift.
      </p>

      <div className="mt-6">
        <Banner tone="warning" title="Demo mode">
          No real money. Balances are simulated so the escrow engine can be exercised end to end.
        </Banner>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        {/* ---------------------------------------------------------- ledger -- */}
        <div className="min-w-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat
              label="Available"
              value={money(wallet?.balanceCents ?? 0)}
              tone="accent"
              hint="Free to fund new milestones"
            />
            <Stat
              label="Locked in escrow"
              value={money(wallet?.inEscrowCents ?? 0)}
              tone="info"
              hint="Committed to milestones in progress"
            />
          </div>

          <h2 className="mt-10 text-xl font-semibold tracking-tight">Transaction ledger</h2>
          <p className="mt-1 text-muted">
            Append-only. Rows are never edited or deleted — that’s what makes double-release
            structurally impossible.
          </p>

          {wallet?.ledger.length === 0 && (
            <div className="mt-5">
              <Empty title="No transactions yet" body="Add demo funds to get started." />
            </div>
          )}

          <ul className="mt-5 flex flex-col gap-3">
            {wallet?.ledger.map((row) => {
              const meta = LEDGER_META[row.type] ?? {
                label: row.type,
                description: '',
                tone: 'text-muted',
              };
              const outgoing = row.amountCents < 0;
              return (
                <Card key={row.id} as="li" className="flex items-center justify-between gap-4 py-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <span
                      aria-hidden
                      className={`grid size-10 shrink-0 place-items-center rounded-full ${
                        outgoing ? 'bg-surface-3 text-muted' : 'bg-accent-soft text-accent'
                      }`}
                    >
                      {outgoing ? '↑' : '↓'}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">{meta.label}</p>
                      <p className="truncate text-sm text-muted">
                        {row.note || meta.description} · {new Date(row.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-lg font-semibold tabular-nums ${
                      outgoing ? 'text-muted' : 'text-accent'
                    }`}
                  >
                    {outgoing ? '' : '+'}
                    {money(row.amountCents)}
                  </span>
                </Card>
              );
            })}
          </ul>
        </div>

        {/* ------------------------------------------------------- top-up -- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <h2 className="text-lg font-semibold">Add demo funds</h2>
            <p className="mt-1 text-sm text-muted">
              Top up so you can fund milestones and watch the ledger move.
            </p>
            <form onSubmit={topUp} className="mt-5 flex flex-col gap-4">
              <Field
                label="Amount"
                type="number"
                step="0.01"
                min="1"
                prefix="$"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                name="amount"
              />
              <div className="flex flex-wrap gap-2">
                {['100.00', '500.00', '2000.00'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset)}
                    className="rounded-full border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-accent"
                  >
                    ${Number(preset).toLocaleString()}
                  </button>
                ))}
              </div>
              <FormError message={error} />
              <Button type="submit" loading={loading} className="w-full">
                Add demo funds
              </Button>
            </form>
          </Card>
        </aside>
      </div>
    </div>
  );
}
