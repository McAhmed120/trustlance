'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'trustlance-theme';
/** Fired on the window whenever this tab changes the theme. */
const CHANGE_EVENT = 'trustlance-theme-change';

/**
 * Inline script that runs before first paint.
 *
 * Without this the page renders in the default palette and then snaps to the
 * saved one — a visible flash for every dark-mode user on every navigation. It
 * has to be a blocking inline script in <head>; a React effect runs too late.
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
  var t = localStorage.getItem('${STORAGE_KEY}');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
}catch(e){}})();
`;

/*
 * The theme lives in localStorage + a DOM attribute — an external store, not
 * React state. useSyncExternalStore is the right primitive: it gives a correct
 * SSR snapshot, avoids the setState-in-effect cascade, and keeps every consumer
 * (header toggle, any future consumer) in sync from one source.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  // 'storage' fires in OTHER tabs, so changing the theme in one tab updates the rest.
  window.addEventListener('storage', onChange);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
    mq.removeEventListener('change', onChange);
  };
}

function readStored(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* private mode / storage disabled */
  }
  return 'system';
}

function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Snapshot is a plain string so referential equality holds between reads —
 * returning a fresh object here would make useSyncExternalStore re-render
 * forever.
 */
function getSnapshot(): string {
  const stored = readStored();
  const resolved = stored === 'system' ? (systemIsDark() ? 'dark' : 'light') : stored;
  return `${stored}|${resolved}`;
}

function getServerSnapshot(): string {
  // The server can't know the OS preference; the inline script fixes up the
  // painted colours before hydration either way.
  return 'system|light';
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [stored, resolved] = snapshot.split('|') as [Theme, 'light' | 'dark'];

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* non-fatal: the choice just won't survive a reload */
    }
    const root = document.documentElement;
    if (t === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { theme: stored, resolved, setTheme };
}

/** No provider needed — the store is the DOM plus localStorage. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const SunIcon = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4" />
  </>
);
const MoonIcon = <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />;
const SystemIcon = (
  <>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8m-4-4v4" />
  </>
);

/** Three-way theme control: light / dark / follow the system. */
export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const options: { key: Theme; label: string; icon: React.ReactNode }[] = [
    { key: 'light', label: 'Light', icon: SunIcon },
    { key: 'dark', label: 'Dark', icon: MoonIcon },
    { key: 'system', label: 'System', icon: SystemIcon },
  ];

  // The trigger shows what's on screen rather than the stored preference: on
  // 'system' a moon means "you are currently dark", which is what a user checks.
  const currentIcon = resolved === 'dark' ? MoonIcon : SunIcon;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Theme: ${theme}${theme === 'system' ? ` (${resolved})` : ''}`}
        className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {currentIcon}
        </svg>
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden
            tabIndex={-1}
          />
          <div
            role="radiogroup"
            aria-label="Theme"
            className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl"
          >
            {options.map((o) => (
              <button
                key={o.key}
                role="radio"
                aria-checked={theme === o.key}
                onClick={() => {
                  setTheme(o.key);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 ${
                  theme === o.key ? 'font-medium text-accent' : 'text-foreground'
                }`}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {o.icon}
                </svg>
                {o.label}
                {theme === o.key && (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="ml-auto"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
