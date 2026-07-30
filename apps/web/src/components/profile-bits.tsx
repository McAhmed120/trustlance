'use client';

import type { ReactNode } from 'react';

/** Small shared pieces for the Upwork-style profile page. */

export function PencilButton({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`grid size-8 shrink-0 place-items-center rounded-full border transition-colors ${
        active
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-border text-muted hover:border-accent hover:text-accent'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
  );
}

/** A sidebar block with a heading and an optional edit affordance. */
export function SidebarBlock({
  title,
  onEdit,
  editing,
  children,
}: {
  title: string;
  onEdit?: () => void;
  editing?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border py-5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {onEdit && <PencilButton label={`Edit ${title.toLowerCase()}`} onClick={onEdit} active={editing} />}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A full-width card matching the stacked cards below Upwork's main profile card. */
export function ProfileCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

export function VerifiedCheck({ verified }: { verified: boolean }) {
  if (!verified) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-sm text-warning">
        Unverified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-accent" title="Verified">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2l2.4 1.8 3-.3 1 2.8 2.6 1.5-1 2.8 1 2.8-2.6 1.5-1 2.8-3-.3L12 22l-2.4-1.8-3 .3-1-2.8L3 16.2l1-2.8-1-2.8 2.6-1.5 1-2.8 3 .3z" />
        <path d="M10.6 15.2l-2.4-2.4 1.1-1.1 1.3 1.3 3.5-3.5 1.1 1.1z" fill="var(--surface)" />
      </svg>
      <span className="sr-only">Verified</span>
    </span>
  );
}
