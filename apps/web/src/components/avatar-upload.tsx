'use client';

import { useRef, useState } from 'react';
import type { MeDto } from '@trustlance/shared-types';
import { API_BASE, apiRequest, getAccessToken } from '@/lib/api';
import { Avatar, Button, FormError } from './ui';

/**
 * Profile picture control: shows the current avatar and offers upload / replace
 * / remove. Available to every account type — clients appear on job listings and
 * in contract workspaces, so they benefit from a picture just as freelancers do.
 */
export function AvatarUpload({
  user,
  onChange,
}: {
  user: MeDto;
  onChange: (updated: MeDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const name = user.profile?.displayName ?? 'User';
  const src = user.profile?.avatarUrl ? `${API_BASE}${user.profile.avatarUrl}` : null;

  async function upload(file: File) {
    // Check size client-side too. The server enforces 5 MB, but letting a 40 MB
    // file upload just to be rejected wastes the user's bandwidth and time.
    if (file.size > 5 * 1024 * 1024) {
      setError('That image is larger than 5 MB. Pick a smaller one.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      // Raw fetch, not apiRequest: multipart must not get a JSON Content-Type,
      // and the browser has to set its own multipart boundary.
      const res = await fetch(`${API_BASE}/api/users/me/avatar`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Upload failed');
      }
      onChange((await res.json()) as MeDto);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      onChange(await apiRequest<MeDto>('/api/users/me/avatar', { method: 'DELETE' }));
    } catch {
      setError('Could not remove the picture.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0">
        <Avatar name={name} src={src} size="lg" />
        {/* Camera badge, echoing the reference's pencil-on-avatar affordance. */}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={src ? 'Change profile picture' : 'Upload a profile picture'}
          className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full border-2 border-surface bg-accent text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>

      <div className="min-w-0">
        <p className="font-medium">Profile picture</p>
        <p className="mt-0.5 text-sm text-muted">PNG, JPEG, WebP or GIF · up to 5 MB</p>

        <div className="mt-3 flex flex-wrap gap-3">
          <Button variant="secondary" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
            {src ? 'Change picture' : 'Upload picture'}
          </Button>
          {src && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />

        <div className="mt-3">
          <FormError message={error} />
        </div>
      </div>
    </div>
  );
}
