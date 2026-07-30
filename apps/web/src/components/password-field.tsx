'use client';

import { useState } from 'react';

/**
 * Password input with a show/hide toggle and, optionally, a live strength meter.
 *
 * Revealing the password is a genuine usability win: the alternative is people
 * choosing shorter passwords because long ones are hard to type blind. The
 * meter mirrors the server's actual rule (length ≥ 12, no composition
 * requirements) so it can never encourage something the API will reject.
 */
export function PasswordField({
  label,
  name,
  autoComplete,
  hint,
  error,
  showStrength = false,
  required,
}: {
  label: string;
  name: string;
  autoComplete: string;
  hint?: string;
  error?: string;
  showStrength?: boolean;
  required?: boolean;
}) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const errorId = `${name}-error`;

  /*
   * Caps Lock is one of the most common causes of "my password is wrong" and
   * one nobody diagnoses on their own — the field is masked, so there is no
   * feedback at all. getModifierState reads the real key state from the event.
   */
  function checkCapsLock(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.('CapsLock') ?? false);
  }

  // Length is the whole rule, so it's the whole meter. Symbol/digit scoring
  // would imply requirements the server doesn't have.
  const len = value.length;
  const strength = len === 0 ? 0 : len < 8 ? 1 : len < 12 ? 2 : len < 18 ? 3 : 4;
  const meta = [
    { label: '', cls: '' },
    { label: 'Too short', cls: 'bg-danger' },
    { label: 'Almost — 12 characters minimum', cls: 'bg-warning' },
    { label: 'Good', cls: 'bg-accent' },
    { label: 'Strong', cls: 'bg-accent' },
  ][strength];

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={name} className="label">
        {label}
      </label>

      <div className="relative">
        <input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyUp={checkCapsLock}
          onKeyDown={checkCapsLock}
          onBlur={() => setCapsLock(false)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="input pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:text-foreground"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {visible ? (
              <>
                <path d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a19 19 0 0 1 5.1-5.9m3.9-1.9A10.1 10.1 0 0 1 12 4c7 0 11 8 11 8a19 19 0 0 1-2.2 3.2" />
                <path d="M9.9 4.2 20 20M1 1l22 22" />
              </>
            ) : (
              <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </div>

      {capsLock && (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-warning">
          <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3 4 11h4v5h8v-5h4z" />
            <path d="M8 20h8" />
          </svg>
          Caps Lock is on
        </p>
      )}

      {showStrength && len > 0 && (
        <div aria-live="polite">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= strength ? meta.cls : 'bg-border'
                }`}
              />
            ))}
          </div>
          <p className={`mt-1.5 text-sm ${strength >= 3 ? 'text-accent' : 'text-muted'}`}>
            {meta.label}
          </p>
        </div>
      )}

      {hint && !error && (!showStrength || len === 0) && <p className="text-sm text-muted">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
