'use client';

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import type { MilestoneState } from '@trustlance/shared-types';

/**
 * Shared primitives.
 *
 * Every form control wires its own label and error id, so accessibility is the
 * default rather than a later audit item. Sizes are deliberately generous —
 * 16px text and 44px-tall controls, which is also the minimum comfortable
 * touch target on mobile.
 */

// ------------------------------------------------------------------ layout --

export function PageHeader({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>
        )}
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-lg text-muted text-pretty">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 gap-3">{action}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Card({
  children,
  hover,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  hover?: boolean;
  className?: string;
  as?: 'div' | 'li' | 'article';
}) {
  return <Tag className={`card ${hover ? 'card-hover' : ''} ${className}`}>{children}</Tag>;
}

// -------------------------------------------------------------- feedback ----

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-muted">
      <span
        aria-hidden
        className="size-5 animate-spin rounded-full border-2 border-border border-t-accent"
      />
      <span>{label}</span>
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface-2 px-8 py-16 text-center">
      <p className="text-lg font-medium">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-md text-muted">{body}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-danger-bg px-4 py-3 text-danger"
    >
      <span aria-hidden className="mt-0.5 font-semibold">
        !
      </span>
      <span>{message}</span>
    </p>
  );
}

export function Banner({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'accent';
  title?: string;
  children: ReactNode;
}) {
  const cls = {
    info: 'bg-info-bg text-info',
    success: 'bg-success-bg text-success',
    warning: 'bg-warning-bg text-warning',
    danger: 'bg-danger-bg text-danger',
    accent: 'bg-accent-soft text-accent',
  }[tone];
  return (
    <div className={`rounded-xl px-5 py-4 ${cls}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ forms ----

export function Field({
  label,
  error,
  hint,
  id,
  prefix,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  /** Rendered inside the control, e.g. a "$" on money inputs. */
  prefix?: string;
  // React 19 accepts `ref` as an ordinary prop on function components, so no
  // forwardRef wrapper is needed to let callers focus the input.
  ref?: React.Ref<HTMLInputElement>;
}) {
  const inputId = id ?? props.name;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="label">
        {label}
      </label>
      {prefix ? (
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
          >
            {prefix}
          </span>
          <input
            id={inputId}
            ref={ref}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="input pl-9"
            {...props}
          />
        </div>
      ) : (
        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="input"
          {...props}
        />
      )}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextareaField({
  label,
  error,
  hint,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const inputId = id ?? props.name;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="label">
        {label}
      </label>
      <textarea
        id={inputId}
        rows={5}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="input resize-y"
        {...props}
      />
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  error,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  const inputId = id ?? props.name;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="label">
        {label}
      </label>
      <select id={inputId} className="input" {...props}>
        {children}
      </select>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Button({
  loading,
  variant = 'primary',
  size,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'lg';
}) {
  const variantCls = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  }[variant];
  const sizeCls = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  return (
    <button
      // Disabling in flight is the cheapest defence against double-submits —
      // which matter a great deal on endpoints that move money.
      disabled={loading || props.disabled}
      className={`${variantCls} ${sizeCls} ${className}`}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current"
        />
      )}
      {loading ? 'Working…' : children}
    </button>
  );
}

// ----------------------------------------------------------------- display ---

export function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/**
 * Avatar: the uploaded image when there is one, initials otherwise.
 *
 * Plain <img> rather than next/image — these are user uploads served from the
 * API origin, and routing them through the Next optimiser would need that host
 * allow-listed for no benefit at this size.
 */
export function Avatar({
  name,
  src,
  size = 'md',
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const cls = {
    sm: 'size-9 text-sm',
    md: 'size-12 text-base',
    lg: 'size-20 text-2xl',
    xl: 'size-28 text-4xl',
  }[size];

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${name}'s profile picture`}
        className={`shrink-0 rounded-full object-cover ${cls}`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent ${cls}`}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Stat({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'accent' | 'info' | 'muted';
  hint?: string;
}) {
  const toneCls = {
    default: 'text-foreground',
    accent: 'text-accent',
    info: 'text-info',
    muted: 'text-muted',
  }[tone];
  return (
    <div className="card">
      <p className="text-sm font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/**
 * Escrow state pill.
 *
 * Colour carries meaning: funded/in-progress are "money committed, unresolved";
 * awaiting-review is attention-needed-soon; disputed is attention-needed-now;
 * released/resolved are terminal-good. Never restyle these to match a theme.
 */
export function StateBadge({ state, size = 'md' }: { state: MilestoneState; size?: 'sm' | 'md' }) {
  const map: Record<MilestoneState, { label: string; cls: string; dot: string }> = {
    CREATED: { label: 'Awaiting funding', cls: 'bg-surface-3 text-muted', dot: 'bg-muted' },
    FUNDED: { label: 'Funded', cls: 'bg-info-bg text-info', dot: 'bg-info' },
    IN_PROGRESS: { label: 'In progress', cls: 'bg-info-bg text-info', dot: 'bg-info' },
    SUBMITTED: { label: 'Awaiting review', cls: 'bg-warning-bg text-warning', dot: 'bg-warning' },
    DISPUTED: { label: 'Disputed', cls: 'bg-danger-bg text-danger', dot: 'bg-danger' },
    RELEASED: { label: 'Released', cls: 'bg-success-bg text-success', dot: 'bg-success' },
    RESOLVED: { label: 'Resolved by arbitrator', cls: 'bg-success-bg text-success', dot: 'bg-success' },
    CANCELLED: { label: 'Cancelled', cls: 'bg-surface-3 text-muted', dot: 'bg-muted' },
  };
  const { label, cls, dot } = map[state];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full font-medium ${cls} ${
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      }`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/** Horizontal milestone progress, so a contract's shape is legible at a glance. */
export function MilestoneProgress({ states }: { states: MilestoneState[] }) {
  const done = states.filter((s) => ['RELEASED', 'RESOLVED'].includes(s)).length;
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-2 flex-1 gap-1 overflow-hidden rounded-full">
        {states.map((s, i) => (
          <span
            key={i}
            className={`h-full flex-1 rounded-full ${
              ['RELEASED', 'RESOLVED'].includes(s)
                ? 'bg-accent'
                : s === 'DISPUTED'
                  ? 'bg-danger'
                  : s === 'CANCELLED'
                    ? 'bg-border'
                    : ['FUNDED', 'IN_PROGRESS', 'SUBMITTED'].includes(s)
                      ? 'bg-info'
                      : 'bg-border'
            }`}
          />
        ))}
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted">
        {done}/{states.length}
      </span>
    </div>
  );
}
