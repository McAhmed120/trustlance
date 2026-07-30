'use client';

import { create } from 'zustand';
import type { AuthResponse, LoginRequest, MeDto, RegisterRequest } from '@trustlance/shared-types';
import { apiRequest, bootstrapSession, setAccessToken } from '@/lib/api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  user: MeDto | null;
  status: Status;
  register: (input: RegisterRequest) => Promise<void>;
  login: (input: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  setUser: (user: MeDto) => void;
}

/**
 * Global auth state.
 *
 * Note what is NOT persisted: the access token. It lives only in the api module
 * (see lib/api.ts), never in this store's serialized state, and never in
 * localStorage. The store holds the user object for rendering; the token is a
 * credential and is kept out of anything that could be written to disk.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',

  async register(input) {
    const res = await apiRequest<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: input,
    });
    setAccessToken(res.accessToken);
    set({ user: res.user, status: 'authenticated' });
  },

  async login(input) {
    const res = await apiRequest<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: input,
    });
    setAccessToken(res.accessToken);
    set({ user: res.user, status: 'authenticated' });
  },

  async logout() {
    // Best-effort: even if the server call fails, clear local state so the UI
    // never shows a logged-in shell for a session the user meant to end.
    try {
      // Goes through apiRequest so it carries the client header that
      // cookie-authenticated endpoints require under SameSite=None.
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      set({ user: null, status: 'anonymous' });
    }
  },

  async bootstrap() {
    const res = await bootstrapSession();
    if (res) set({ user: res.user, status: 'authenticated' });
    else set({ user: null, status: 'anonymous' });
  },

  setUser(user) {
    set({ user });
  },
}));
