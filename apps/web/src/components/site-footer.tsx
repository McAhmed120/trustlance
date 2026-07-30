import Link from 'next/link';

/**
 * Dark mega-footer, following Upwork's shape: four link columns, a social row,
 * then a legal bar.
 *
 * Only real destinations are linked. Upwork's footer is dense with company
 * pages that don't exist here, so the columns describe what TrustLance actually
 * has rather than inventing About/Careers/Press pages that would 404.
 */
const COLUMNS: { heading: string; links: { label: string; href?: string }[] }[] = [
  {
    heading: 'For clients',
    links: [
      { label: 'Post a job', href: '/jobs/new' },
      { label: 'How escrow works', href: '/#how-it-works' },
      { label: 'Dispute resolution', href: '/#payment' },
      { label: 'Your wallet', href: '/wallet' },
    ],
  },
  {
    heading: 'For freelancers',
    links: [
      { label: 'Find work', href: '/jobs' },
      { label: 'Build a trust profile', href: '/profile' },
      { label: 'Export your records', href: '/profile' },
      { label: 'Getting paid', href: '/#how-it-works' },
    ],
  },
  {
    heading: 'Trust & verification',
    links: [
      { label: 'Verify a record', href: '/verify' },
      { label: 'Append-only ledger', href: '/#payment' },
      { label: 'Tamper-evident time logs', href: '/#trust' },
      { label: 'Ed25519 signatures', href: '/verify' },
    ],
  },
  {
    heading: 'Project',
    links: [
      // Documented in the repo rather than as marketing pages.
      { label: 'Escrow is simulated' },
      { label: 'No real payments' },
      { label: 'All six sprints complete' },
      { label: 'Portfolio build' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-20 bg-[#0f1310] text-[#d7e0d7]">
      <div className="container-wide py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
                {col.heading}
              </h2>
              <ul className="mt-4 flex flex-col gap-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href ? (
                      <Link href={l.href} className="text-[#d7e0d7] hover:text-white hover:underline">
                        {l.label}
                      </Link>
                    ) : (
                      <span className="text-white/45">{l.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-white/10 pt-8">
          {/* Same wordmark as the header — a different mark in the footer reads
              as a different product. */}
          <Link href="/" className="text-xl font-bold lowercase tracking-[-0.03em] text-white">
            trustlance
            <span aria-hidden className="text-accent">
              .
            </span>
          </Link>

          <p className="text-sm text-white/45">
            Portable reputation &amp; milestone escrow · escrow simulated, no real payments
          </p>
        </div>
      </div>
    </footer>
  );
}
