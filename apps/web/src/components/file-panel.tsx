'use client';

import { useRef, useState } from 'react';
import { API_BASE, getAccessToken } from '@/lib/api';
import { useFiles } from '@/lib/hooks';
import { Card, Empty, FormError, Pill, Spinner } from './ui';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Contract file sharing with implicit versioning (same filename bumps version). */
export function FilePanel({ contractId }: { contractId: string }) {
  const { data: files, isLoading, refetch } = useFiles(contractId);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      // Raw fetch, not apiRequest: multipart must not get a JSON Content-Type,
      // and the browser has to set its own multipart boundary.
      const res = await fetch(`${API_BASE}/api/contracts/${contractId}/files`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Upload failed');
      }
      await refetch();
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function download(fileId: string, filename: string) {
    const res = await fetch(`${API_BASE}/api/contracts/${contractId}/files/${fileId}/download`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2'
        }`}
      >
        <span aria-hidden className="inline-grid size-12 place-items-center rounded-full bg-surface text-muted">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 16V4M6 10l6-6 6 6" />
            <path d="M4 20h16" />
          </svg>
        </span>
        <p className="mt-4 font-medium">
          {uploading ? 'Uploading…' : 'Drop a file here, or'}{' '}
          {!uploading && (
            <label htmlFor="file-upload" className="link cursor-pointer">
              browse
            </label>
          )}
        </p>
        <input
          id="file-upload"
          ref={inputRef}
          type="file"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
          className="sr-only"
        />
        <p className="mt-2 text-sm text-muted">
          Images, PDF, ZIP, text — up to 20 MB. Re-uploading the same filename creates a new version.
        </p>
        <div className="mt-4">
          <FormError message={error} />
        </div>
      </div>

      {isLoading && <Spinner />}
      {files?.length === 0 && <Empty title="No files shared yet" />}

      <ul className="flex flex-col gap-3">
        {files?.map((f) => (
          <Card key={f.id} as="li" className="flex items-center justify-between gap-4 py-4">
            <div className="flex min-w-0 items-center gap-4">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-3 text-muted"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              </span>
              <div className="min-w-0">
                <button
                  onClick={() => void download(f.id, f.filename)}
                  className="block truncate font-medium hover:text-accent hover:underline"
                >
                  {f.filename}
                </button>
                <p className="text-sm text-muted">
                  {humanSize(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            {f.version > 1 && <Pill>v{f.version}</Pill>}
          </Card>
        ))}
      </ul>
    </div>
  );
}
