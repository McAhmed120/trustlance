/**
 * Value panel beside the auth forms.
 *
 * Hidden below lg rather than stacked: on a phone the form is the only thing
 * that matters, and pushing it under a wall of marketing copy is the classic
 * way to lose a signup.
 */
export function AuthAside({ variant }: { variant: 'login' | 'register' }) {
  const points =
    variant === 'register'
      ? [
          {
            t: 'It’s signed, not stored',
            d: 'Each completed milestone becomes an Ed25519-signed document. Anyone can verify it with a public key — no login, no database.',
          },
          {
            t: 'It’s yours to export',
            d: 'Download the whole bundle whenever you like and take it to a client, a new platform, or a pitch deck.',
          },
          {
            t: 'Money is never ambiguous',
            d: 'Escrow funds, releases and refunds are append-only ledger rows. Both sides see identical numbers.',
          },
        ]
      : [
          {
            t: 'Your records are waiting',
            d: 'Every milestone you completed is still signed and still verifiable — nothing expires.',
          },
          {
            t: 'Escrow keeps its state',
            d: 'Funded milestones, open disputes and auto-release timers all continue while you’re away.',
          },
          {
            t: 'One session, everywhere',
            d: 'Refresh tokens rotate per use, so a leaked session is detected and killed rather than reused.',
          },
        ];

  return (
    <aside className="hidden h-full border-l border-border bg-surface-2 lg:flex lg:items-center">
      <div className="px-12 py-16 xl:px-16">
        <h2 className="text-2xl font-semibold tracking-tight text-balance xl:text-3xl">
          {variant === 'register'
            ? 'Why a TrustLance record is worth more than a five-star average'
            : 'Welcome back to reputation you actually own'}
        </h2>

        <ul className="mt-10 flex flex-col gap-7">
          {points.map((i) => (
            <li key={i.t} className="flex gap-4">
              <span
                aria-hidden
                className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent text-accent-fg"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <span>
                <span className="block font-medium">{i.t}</span>
                <span className="mt-1 block leading-relaxed text-muted">{i.d}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-12 border-t border-border pt-6 text-sm text-muted">
          Escrow is simulated in this build — no real payments are processed anywhere.
        </p>
      </div>
    </aside>
  );
}
