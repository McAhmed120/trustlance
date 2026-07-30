'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ContractDto,
  JobDto,
  MessageDto,
  NotificationDto,
  ProposalDto,
  PublicUserDto,
  WalletDto,
  WorkRecordDto,
} from '@trustlance/shared-types';
import { API_BASE, apiRequest, getAccessToken } from './api';

/** Formats integer cents as USD. Every money value in the UI goes through this. */
export function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// ------------------------------------------------------------------ jobs ----

export function useJobs(filters: Record<string, string> = {}) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => apiRequest<JobDto[]>(`/api/jobs${qs ? `?${qs}` : ''}`),
  });
}

export function useJob(jobId: string) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => apiRequest<JobDto>(`/api/jobs/${jobId}`),
    enabled: Boolean(jobId),
  });
}

/**
 * Public projection of a user. Needed on the own-profile page too: MeDto
 * deliberately omits trustScore (it's a computed, publicly-visible field), so
 * the score is read from the same endpoint everyone else sees.
 */
export function usePublicUser(userId: string | undefined) {
  return useQuery({
    queryKey: ['publicUser', userId],
    queryFn: () => apiRequest<PublicUserDto>(`/api/users/${userId}`),
    enabled: Boolean(userId),
  });
}

export function useMyJobs() {
  return useQuery({ queryKey: ['jobs', 'mine'], queryFn: () => apiRequest<JobDto[]>('/api/jobs/mine') });
}

export function useJobProposals(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['proposals', jobId],
    queryFn: () => apiRequest<ProposalDto[]>(`/api/jobs/${jobId}/proposals`),
    enabled,
  });
}

export function useMyProposals() {
  return useQuery({
    queryKey: ['proposals', 'mine'],
    queryFn: () => apiRequest<ProposalDto[]>('/api/proposals/mine'),
  });
}

// ------------------------------------------------------------- contracts ----

export function useMyContracts() {
  return useQuery({
    queryKey: ['contracts', 'mine'],
    queryFn: () => apiRequest<ContractDto[]>('/api/contracts/mine'),
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: ['contract', id],
    queryFn: () => apiRequest<ContractDto>(`/api/contracts/${id}`),
    enabled: Boolean(id),
  });
}

// ---------------------------------------------------------------- wallet ----

export function useWallet() {
  return useQuery({ queryKey: ['wallet'], queryFn: () => apiRequest<WalletDto>('/api/wallet') });
}

/**
 * Any escrow action invalidates the contract AND the wallet: a release changes
 * both a milestone's state and two balances, and showing one updated without
 * the other is exactly the kind of inconsistency this project is about.
 */
export function useMilestoneAction(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: unknown }) =>
      apiRequest(`/api/milestones/${id}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contract', contractId] });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['contracts', 'mine'] });
    },
  });
}

// ------------------------------------------------------------ reputation ----

export function useWorkRecords(userId: string) {
  return useQuery({
    queryKey: ['records', userId],
    queryFn: () => apiRequest<WorkRecordDto[]>(`/api/reputation/${userId}/records`),
    enabled: Boolean(userId),
  });
}

// --------------------------------------------------------- notifications ----

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiRequest<NotificationDto[]>('/api/notifications'),
  });
}

// ------------------------------------------------------------- workspace ----

export function useMessages(contractId: string) {
  return useQuery({
    queryKey: ['messages', contractId],
    queryFn: () => apiRequest<MessageDto[]>(`/api/contracts/${contractId}/messages`),
    enabled: Boolean(contractId),
  });
}

export function useTimeEntries(contractId: string) {
  return useQuery({
    queryKey: ['time', contractId],
    queryFn: () =>
      apiRequest<{ chainValid: boolean; entries: import('@trustlance/shared-types').TimeEntryDto[] }>(
        `/api/contracts/${contractId}/time`,
      ),
    enabled: Boolean(contractId),
  });
}

export function useFiles(contractId: string) {
  return useQuery({
    queryKey: ['files', contractId],
    queryFn: () => apiRequest<import('@trustlance/shared-types').FileDto[]>(`/api/contracts/${contractId}/files`),
    enabled: Boolean(contractId),
  });
}

// -------------------------------------------------------------- realtime ----

let socket: Socket | null = null;

function getSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) return null;
  if (socket?.connected) return socket;
  socket?.close();
  socket = io(API_BASE, { auth: { token }, transports: ['websocket'] });
  return socket;
}

/**
 * Subscribes to live events for a contract room and invalidates the affected
 * queries. Server-pushed invalidation rather than polling: a milestone state
 * change must appear for the counterparty immediately, since the whole point
 * of the escrow UI is that both sides see the same state.
 */
export function useContractRealtime(contractId: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!contractId) return;
    const s = getSocket();
    if (!s) return;

    const join = () => s.emit('contract:join', contractId);
    join();
    s.on('connect', join);

    const onMilestone = () => {
      void qc.invalidateQueries({ queryKey: ['contract', contractId] });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    };
    const onMessage = (msg: MessageDto) => {
      qc.setQueryData<MessageDto[]>(['messages', contractId], (old) =>
        // Guard against echoing our own optimistic insert twice.
        old && !old.some((m) => m.id === msg.id) ? [...old, msg] : old,
      );
    };
    const onFile = () => void qc.invalidateQueries({ queryKey: ['files', contractId] });
    const onTime = () => void qc.invalidateQueries({ queryKey: ['time', contractId] });

    s.on('milestone:update', onMilestone);
    s.on('chat:message', onMessage);
    s.on('file:new', onFile);
    s.on('time:entry', onTime);

    return () => {
      s.off('connect', join);
      s.off('milestone:update', onMilestone);
      s.off('chat:message', onMessage);
      s.off('file:new', onFile);
      s.off('time:entry', onTime);
    };
  }, [contractId, qc]);
}

/** Live notification badge updates. */
export function useNotificationRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onNotif = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
    s.on('notification', onNotif);
    // Braces matter: `s.off(...)` returns the socket, and an arrow returning a
    // value is not a valid effect destructor.
    return () => {
      s.off('notification', onNotif);
    };
  }, [qc]);
}
