'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { JOB_CATEGORIES } from '@trustlance/shared-types';
import { SiteFooter } from '@/components/site-footer';
import { Reveal } from '@/components/reveal';
import { TechMark, type MarkName } from '@/components/tech-marks';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/api';
import { Avatar } from '@/components/ui';

/**
 * Marketing landing page, following Upwork's information architecture:
 * announcement strip → dark hero with a talent/jobs search toggle → category
 * grid → how-it-works with an audience toggle → dark explainer → two payment
 * cards → trust proof → gradient CTA → mega-footer.
 *
 * Two deliberate departures from the reference, both honesty-driven:
 *
 *  - Upwork's hero carries a client-logo strip (Microsoft, Airbnb…). Inventing
 *    customer logos for a portfolio build would be a fabricated endorsement, so
 *    that slot shows the actual cryptographic primitives instead.
 *  - Upwork's "Real results from clients" is six testimonials with names, faces
 *    and dates. Fabricating those would be worse than leaving the section out,
 *    so the same slot explains what a verifiable record proves — which is the
 *    real trust argument here anyway.
 */
export default function Home() {
  return (
    <>
      <AnnouncementStrip />
      <Hero />
      <TrustedStrip />
      <Categories />
      <HowItWorks />
      <EscrowExplainer />
      <PaymentCards />
      <ProvenResults />
      <TrustProof />
      <FinalCta />
      <SiteFooter />
    </>
  );
}

function AnnouncementStrip() {
  return (
    <div className="container-wide pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent-soft px-5 py-3">
        <p className="text-foreground">
          Every approved milestone mints a signed record you own — not a review you rent.
        </p>
        <Link href="/verify" className="shrink-0 font-medium text-accent hover:underline">
          Verify one now ›
        </Link>
      </div>
    </div>
  );
}

function Hero() {
  const router = useRouter();
  // Defaults to hiring, matching the reference — a first-time visitor is more
  // often evaluating the platform as a buyer than as a seller.
  const [mode, setMode] = useState<'talent' | 'jobs'>('talent');
  const [q, setQ] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Both modes land on the job board — it's the only browse surface that
    // exists. Talent discovery is reached through a job's proposals.
    router.push(q.trim() ? `/jobs?q=${encodeURIComponent(q.trim())}` : '/jobs');
  }

  return (
    <section className="container-wide pt-6">
      <div className="relative overflow-hidden rounded-2xl bg-[#0f1310] px-8 py-16 sm:px-14 sm:py-20">
        {/* Ambient green wash standing in for Upwork's hero photograph. */}
        <div
          aria-hidden
          className="drift pointer-events-none absolute -right-40 -top-40 size-[36rem] rounded-full bg-accent/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-52 -left-32 size-[30rem] rounded-full bg-accent/10 blur-3xl"
        />

        {/*
          Elements below that sit on always-white chips inside this dark panel use
          a FIXED dark text colour, not text-foreground. In dark mode foreground
          flips to near-white, which rendered the active tab, the search input
          and the CTA label invisible on their white backgrounds.
        */}
        <div className="relative max-w-2xl">
          {/* Staggered load-in: headline, then subcopy, then the search block —
              each 80–160ms behind the last, as on the reference. */}
          <h1 className="rise-in text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Reputation you own.
            <br />
            Escrow you can audit.
          </h1>
          <p className="rise-in mt-6 max-w-xl text-lg text-white/70" style={{ animationDelay: '80ms' }}>
            Connecting clients who want proof of work with freelancers who want proof of trust.
          </p>

          <div className="rise-in mt-12 max-w-2xl" style={{ animationDelay: '160ms' }}>
            {/* Full-width segmented toggle with a pill highlight, matching the
                reference's "I want to hire / I want to work". */}
            <div
              role="tablist"
              aria-label="What do you want to do"
              className="flex w-full max-w-xl rounded-full bg-white/12 p-1 backdrop-blur"
            >
              {(
                [
                  { key: 'talent' as const, label: 'I want to hire' },
                  { key: 'jobs' as const, label: 'I want to work' },
                ]
              ).map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={mode === t.key}
                  onClick={() => setMode(t.key)}
                  className={`flex-1 rounded-full px-6 py-2.5 font-medium transition-all duration-200 ${
                    mode === t.key
                      ? 'bg-white/15 text-white ring-1 ring-white/70'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={onSubmit}
              className="mt-4 flex max-w-xl items-center gap-2 rounded-full bg-white p-1.5 shadow-2xl"
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={mode === 'talent' ? 'Search talent' : 'Search jobs'}
                placeholder={
                  mode === 'talent' ? 'Describe what you need to hire for…' : 'Search by role, skill, or keyword'
                }
                className="min-w-0 flex-1 bg-transparent px-5 py-2 text-[#001e00] placeholder:text-[#5e6d55] focus-visible:outline-none"
              />
              {/* Dark pill with a green glyph, as in the reference — not a
                  solid green button, which would fight the hero's own green. */}
              <button
                type="submit"
                className="flex shrink-0 items-center gap-2.5 rounded-full bg-[#0f1310] px-6 py-3 font-medium text-white transition-transform hover:scale-[1.03]"
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                Search
              </button>
            </form>

            {/* Quick-link chips with trailing arrows, straight from the reference. */}
            <div className="mt-7 flex flex-wrap gap-3">
              {[
                { label: 'Web development', href: '/jobs?category=web-development' },
                { label: 'Design', href: '/jobs?category=design' },
                { label: 'Data', href: '/jobs?category=data' },
                { label: 'DevOps', href: '/jobs?category=devops' },
              ].map((c) => (
                <Link
                  key={c.label}
                  href={c.href}
                  className="group inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-sm text-white transition-colors hover:border-white hover:bg-white/10"
                >
                  {c.label}
                  <svg
                    aria-hidden
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="transition-transform group-hover:translate-x-0.5"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * "Trusted by" strip — the reference's exact layout: a centred small-caps
 * label above a single greyscale wordmark row that lifts to full colour on
 * hover.
 *
 * What it does NOT do is show real companies' logos. Upwork's strip carries
 * Airbnb, Microsoft, Cloudflare and friends because those are genuinely its
 * customers; putting them here would assert an endorsement that does not exist,
 * using other companies' trademarks to do it. The strip instead names the
 * standards the platform is actually built on — every claim below is verifiable
 * from the source.
 *
 * To swap in client logos later, replace `MARKS` and the label; the layout
 * needs no changes.
 */
const MARKS: { mark: MarkName; name: string; sub: string }[] = [
  { mark: 'ed25519', name: 'Ed25519', sub: 'signatures' },
  { mark: 'jws', name: 'JWS', sub: 'RFC 7515' },
  { mark: 'postgresql', name: 'PostgreSQL', sub: 'ledger' },
  { mark: 'redis', name: 'Redis', sub: 'queues' },
  { mark: 'prisma', name: 'Prisma', sub: 'ORM' },
  { mark: 'nextjs', name: 'Next.js', sub: 'web' },
  { mark: 'socketio', name: 'Socket.IO', sub: 'realtime' },
];

function TrustedStrip() {
  return (
    <section className="container-wide py-14">
      <Reveal>
        <p className="text-center text-sm font-medium uppercase tracking-[0.18em] text-muted">
          Built on standards you can verify
        </p>

        <ul className="mt-9 flex flex-wrap items-start justify-center gap-x-10 gap-y-8">
          {MARKS.map((m, i) => (
            <Reveal as="li" key={m.name} delay={i * 60}>
              {/* Dimmed at rest and lifted on hover, as on the reference strip —
                  logos support the headline rather than competing with it. */}
              <span className="group flex w-28 flex-col items-center gap-2 opacity-60 transition-opacity duration-200 hover:opacity-100">
                <TechMark name={m.mark} className="size-9 transition-transform duration-200 group-hover:scale-110" />
                <span className="text-center">
                  <span className="block font-semibold tracking-tight transition-colors group-hover:text-accent">
                    {m.name}
                  </span>
                  <span className="block text-xs uppercase tracking-wider text-muted">{m.sub}</span>
                </span>
              </span>
            </Reveal>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'web-development': <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />,
  'mobile-development': (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 19h2" />
    </>
  ),
  design: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  writing: <path d="M4 20h16M6 16L18 4l3 3L9 19H6v-3z" />,
  data: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  devops: <path d="M12 2v4m0 12v4M4.9 4.9l2.9 2.9m8.4 8.4l2.9 2.9M2 12h4m12 0h4M4.9 19.1l2.9-2.9m8.4-8.4l2.9-2.9" />,
  other: (
    <>
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </>
  ),
};

function Categories() {
  return (
    <section className="container-wide py-16">
      <Reveal>
        <h2 className="text-3xl font-semibold tracking-tight">Explore work by category</h2>
      </Reveal>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {JOB_CATEGORIES.map((c, i) => (
          <Reveal key={c} delay={i * 70}>
          <Link
            key={c}
            href={`/jobs?category=${c}`}
            className="lift group flex items-start gap-4 rounded-xl border border-border bg-surface p-5 hover:border-accent hover:bg-surface-2"
          >
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {CATEGORY_ICONS[c]}
              </svg>
            </span>
            <span className="font-medium capitalize">{c.replace(/-/g, ' ')}</span>
          </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const [audience, setAudience] = useState<'hiring' | 'working'>('hiring');

  const steps =
    audience === 'hiring'
      ? [
          { t: 'Posting a job is free', d: 'Describe the work and set a budget. Nothing is charged when you post.' },
          { t: 'Review proposals and trust scores', d: 'Every freelancer’s score is computed from signed records, not self-reported stars.' },
          { t: 'Fund milestones, approve, done', d: 'Money leaves your wallet per milestone and only moves when you approve.' },
        ]
      : [
          { t: 'Bid on work that fits', d: 'One proposal per job. Your trust profile travels with you from day one.' },
          { t: 'See the money before you start', d: 'Escrow is funded before work begins, and you can see it locked against the milestone.' },
          { t: 'Get paid and get proof', d: 'Approval releases escrow and mints a signed record you own forever.' },
        ];

  return (
    <section id="how-it-works" className="border-t border-border bg-surface-2 py-16">
      <div className="container-wide">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>

          <div role="tablist" aria-label="Audience" className="inline-flex rounded-full border border-border bg-surface p-1">
            {(
              [
                { key: 'hiring' as const, label: 'For hiring' },
                { key: 'working' as const, label: 'For finding work' },
              ]
            ).map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={audience === t.key}
                onClick={() => setAudience(t.key)}
                className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                  audience === t.key ? 'bg-accent text-accent-fg' : 'text-muted hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal as="li" key={s.t} delay={i * 90} className="lift rounded-2xl border border-border bg-surface p-6">
              <span
                aria-hidden
                className="grid size-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-fg"
              >
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 leading-relaxed text-muted">{s.d}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function EscrowExplainer() {
  return (
    <section id="trust" className="container-wide py-16">
      <div className="grid gap-10 rounded-2xl bg-[#0f1310] p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-white text-balance">
            Both sides watch the same ledger
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-white/70">
            There is no stored balance to argue about. Every figure in TrustLance is summed from an
            append-only ledger, so client and freelancer are always looking at identical numbers.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {[
              'Rows are never edited or deleted',
              'Releasing twice is structurally impossible',
              'Either party can escalate to an arbitrator',
            ].map((t) => (
              <li key={t} className="flex items-center gap-3 text-white/85">
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Ledger mock — the product's actual shape, legible before signup. */}
        <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <p className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Milestone ledger
          </p>
          <ul className="mt-5 flex flex-col gap-3">
            {[
              { t: 'FUND', d: 'Client → escrow', v: '+$1,400.00', c: 'text-info' },
              { t: 'RELEASE', d: 'Escrow → freelancer', v: '+$1,400.00', c: 'text-accent' },
              { t: 'REFUND', d: 'Escrow → client', v: '$0.00', c: 'text-white/45' },
            ].map((r) => (
              <li key={r.t} className="flex items-center justify-between gap-4 rounded-xl bg-white/5 px-4 py-3">
                <span>
                  <span className="block font-mono text-sm text-white">{r.t}</span>
                  <span className="block text-sm text-white/50">{r.d}</span>
                </span>
                <span className={`font-semibold tabular-nums ${r.c}`}>{r.v}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 flex items-center gap-2 rounded-xl bg-accent/15 px-4 py-3 text-sm text-accent">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Balances derived, never stored
          </p>
        </div>
      </div>
    </section>
  );
}

function PaymentCards() {
  const plans = [
    {
      name: 'Fixed-price milestones',
      tag: 'How most contracts run',
      highlight: false,
      features: [
        'Client funds each milestone separately',
        'Freelancer sees escrow before starting',
        'Approval releases payment instantly',
        'Auto-release if the client goes quiet',
      ],
    },
    {
      name: 'Protected by arbitration',
      tag: 'When something goes wrong',
      highlight: true,
      features: [
        'Either party can open a dispute',
        'Escrow freezes until it is resolved',
        'Chat, files and time logs auto-attached',
        'Arbitrator splits funds by percentage',
      ],
    },
  ];

  return (
    <section id="payment" className="border-t border-border bg-surface-2 py-16">
      <div className="container-wide">
        <h2 className="text-3xl font-semibold tracking-tight">Money only moves on approval</h2>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          Escrow is simulated in this build — no real payments are processed anywhere.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {plans.map((p) => (
            <Reveal
              key={p.name}
              delay={p.highlight ? 120 : 0}
              className={`lift relative rounded-2xl border-2 bg-surface p-7 ${
                p.highlight ? 'border-accent' : 'border-border'
              }`}
            >
              {p.highlight && (
                <span className="absolute -top-3 right-6 rounded-full bg-accent px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-fg">
                  Built in
                </span>
              )}
              <h3 className="text-xl font-semibold">{p.name}</h3>
              <p className="mt-1 text-muted">{p.tag}</p>

              <ul className="mt-6 flex flex-col gap-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href="/register"
                className={`mt-8 w-full ${p.highlight ? 'btn-primary' : 'btn-secondary'}`}
              >
                Get started for free
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ShowcaseRecord {
  id: string;
  title: string;
  amountCents: number;
  completedAt: string;
  rating: number | null;
  feedback: string | null;
  freelancerId: string;
  freelancerName: string;
  freelancerAvatarUrl: string | null;
  freelancerTrustScore: number | null;
  skills: string[];
}

/**
 * "Proven results" — the reference's testimonial grid, but populated from the
 * platform's OWN completed work rather than written copy.
 *
 * Upwork fills this slot with client quotes. Inventing quotes and attributing
 * them to named people would be fabricated social proof, so these cards are
 * real signed records: actual milestone titles, amounts, ratings and the
 * client's own feedback text, each linking to a profile where the signature can
 * be verified. When there is nothing to show yet, the section explains why
 * instead of faking it.
 */
function ProvenResults() {
  const { data: records, isLoading } = useQuery({
    queryKey: ['showcase'],
    queryFn: async (): Promise<ShowcaseRecord[]> => {
      const res = await fetch(`${API_BASE}/api/reputation/showcase`);
      if (!res.ok) return [];
      return res.json();
    },
    // Marketing content — a minute of staleness is fine and avoids refetching
    // on every navigation back to the landing page.
    staleTime: 60_000,
  });

  const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  return (
    <section className="container-wide py-20">
      <Reveal>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Proven results on TrustLance
        </h2>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          Not testimonials — actual signed records from completed milestones. Every one can be
          verified against the platform’s public key.
        </p>
      </Reveal>

      {isLoading && (
        <p className="mt-10 text-muted">Loading recent work…</p>
      )}

      {records && records.length === 0 && (
        <Reveal>
          <div className="mt-10 rounded-2xl border border-dashed border-border bg-surface-2 px-8 py-14 text-center">
            <p className="text-lg font-medium">No completed work to show yet</p>
            <p className="mx-auto mt-2 max-w-md text-muted">
              This section fills itself from real approved milestones. Nothing here is written copy,
              so it stays empty until the first contract completes.
            </p>
            <Link href="/jobs" className="btn-primary mt-6">
              Browse open jobs
            </Link>
          </div>
        </Reveal>
      )}

      {records && records.length > 0 && (
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {records.map((r, i) => (
            <Reveal as="article" key={r.id} delay={i * 80} className="lift card flex flex-col">
              {/* Category-ish eyebrow: the freelancer's own skills. */}
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="grid size-5 place-items-center rounded-full bg-accent text-accent-fg"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                  {r.skills.length ? r.skills.join(' · ') : 'Verified record'}
                </span>
              </div>

              <p className="mt-4 text-lg font-medium leading-snug text-balance">{r.title}</p>

              {r.feedback && (
                <p className="mt-3 leading-relaxed text-muted">“{r.feedback}”</p>
              )}

              {r.rating != null && (
                <p aria-label={`${r.rating} out of 5`} className="mt-4 text-accent">
                  {'★'.repeat(r.rating)}
                  <span className="text-border">{'★'.repeat(5 - r.rating)}</span>
                </p>
              )}

              <div className="mt-auto flex items-center gap-3 border-t border-border pt-5">
                <Link href={`/u/${r.freelancerId}`} className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={r.freelancerName}
                    src={r.freelancerAvatarUrl ? API_BASE + r.freelancerAvatarUrl : null}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium hover:underline">
                      {r.freelancerName}
                    </span>
                    <span className="block text-sm text-muted">
                      {new Date(r.completedAt).toLocaleDateString()}
                      {r.freelancerTrustScore != null && ` · trust ${r.freelancerTrustScore.toFixed(1)}`}
                    </span>
                  </span>
                </Link>
                <span className="ml-auto shrink-0 font-semibold tabular-nums">
                  {usd(r.amountCents)}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </section>
  );
}

function TrustProof() {
  const items = [
    {
      label: 'What is signed',
      title: 'The facts of the job',
      body: 'Freelancer, client, contract, milestone title, amount in cents, rating, and the exact completion timestamp — sealed together in one document.',
    },
    {
      label: 'Who can check it',
      title: 'Anyone, with no account',
      body: 'Verification needs only the platform’s public Ed25519 key. No login, no API call, no trust in a live database.',
    },
    {
      label: 'What it survives',
      title: 'This platform shutting down',
      body: 'Export the bundle and the proof keeps working. A single altered character makes the signature fail.',
    },
  ];

  return (
    <section className="container-wide py-16">
      <h2 className="text-3xl font-semibold tracking-tight">
        Why a signed record beats a five-star average
      </h2>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        Ratings live in someone else’s database. A signature is a fact you carry with you.
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {items.map((i, idx) => (
          <Reveal as="article" key={i.title} delay={idx * 90} className="lift rounded-2xl border border-border bg-surface p-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-accent">{i.label}</p>
            <h3 className="mt-3 text-xl font-semibold">{i.title}</h3>
            <p className="mt-3 leading-relaxed text-muted">{i.body}</p>
          </Reveal>
        ))}
      </div>

      <div className="mt-8">
        <Link href="/verify" className="btn-secondary">
          Try the verifier — no account needed
        </Link>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="container-wide pb-6">
      {/*
        Deliberately tall and saturated, matching the reference's full-width
        green band: the previous version was a thin strip that read as a footnote
        rather than the page's closing call to action. The gradient runs
        diagonally through the brand green so it has depth at this size.
      */}
      <div className="rounded-3xl bg-[linear-gradient(115deg,var(--accent)_0%,#12b400_45%,#0a8f00_100%)] px-8 py-24 text-center sm:px-16 sm:py-28">
        <h2 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white text-balance sm:text-5xl">
          Start building a track record that travels with you
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg text-white/90 text-pretty sm:text-xl">
          Free to join. Post a job or submit your first proposal in a couple of minutes.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/register"
            className="inline-flex items-center justify-center rounded-full bg-white px-8 py-4 text-lg font-medium text-[#001e00] transition-opacity hover:opacity-90"
          >
            Create your account
          </Link>
          <Link
            href="/jobs"
            className="inline-flex items-center justify-center rounded-full border border-white/40 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-white/10"
          >
            Browse jobs
          </Link>
        </div>
      </div>
    </section>
  );
}
