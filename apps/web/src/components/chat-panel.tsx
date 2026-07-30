'use client';

import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { useMessages } from '@/lib/hooks';
import { useAuthStore } from '@/stores/auth';
import { Avatar, Button, Empty, Spinner } from './ui';

/** Contract-scoped chat. New messages arrive via the socket (see useContractRealtime). */
export function ChatPanel({ contractId }: { contractId: string }) {
  const { data: messages, isLoading } = useMessages(contractId);
  const me = useAuthStore((s) => s.user?.id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as history loads and new ones stream in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await apiRequest(`/api/contracts/${contractId}/messages`, { method: 'POST', body: { body } });
      setText('');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex max-h-[28rem] min-h-64 flex-col gap-5 overflow-y-auto rounded-2xl border border-border bg-surface p-6">
        {isLoading && <Spinner />}
        {messages?.length === 0 && (
          <Empty title="No messages yet" body="Say hello and agree on the details." />
        )}
        {messages?.map((m) => {
          const mine = m.senderId === me;
          return (
            <div key={m.id} className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}>
              <Avatar name={m.senderName} size="sm" />
              <div className={`flex max-w-[75%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-4 py-3 leading-relaxed ${
                    mine
                      ? 'rounded-tr-sm bg-accent text-accent-fg'
                      : 'rounded-tl-sm bg-surface-2 text-foreground'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
                <p className="mt-1.5 text-sm text-muted">
                  {mine ? 'You' : m.senderName} ·{' '}
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="mt-4 flex gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message…"
          aria-label="Message"
          className="input flex-1"
        />
        <Button type="submit" loading={sending} disabled={!text.trim()}>
          Send
        </Button>
      </form>
      <p className="mt-3 text-sm text-muted">
        Messages are attached automatically as evidence if this contract is ever disputed.
      </p>
    </div>
  );
}
