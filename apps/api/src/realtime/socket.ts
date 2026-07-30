import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import type { Role } from '@trustlance/shared-types';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';

/** Socket with the authenticated identity attached during the handshake. */
export interface AuthedSocket extends Socket {
  data: { userId: string; role: Role };
}

/**
 * Socket.io server with authentication enforced at the handshake.
 *
 * Authenticating in the handshake rather than in a post-connect 'auth' event
 * matters: an unauthenticated socket that is allowed to connect first is a
 * socket that can already emit, join rooms, and consume server resources. The
 * middleware below runs before 'connection' fires, so an invalid token never
 * produces a live socket at all.
 *
 * Rooms are namespaced `contract:<id>` from Sprint 5 onward, so chat, timer and
 * milestone events for one contract fan out only to its two parties.
 */
/**
 * Module-level handle so services (notifications, chat) can emit without
 * threading the io instance through every call site. Null until the HTTP
 * server boots — and in tests, where no socket server exists, emits are
 * silently skipped.
 */
export let io: SocketServer | null = null;

/** Push an event to every open tab a user has. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Push an event to everyone in a contract workspace. */
export function emitToContract(contractId: string, event: string, payload: unknown): void {
  io?.to(`contract:${contractId}`).emit(event, payload);
}

export function createSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    // The browser cannot set an Authorization header on a WebSocket, so the
    // access token arrives via socket.handshake.auth — still the short-lived
    // access token, never the refresh token.
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (typeof socket.handshake.headers.authorization === 'string'
        ? socket.handshake.headers.authorization.replace(/^Bearer /, '')
        : undefined);

    if (!token) {
      next(new Error('UNAUTHORIZED: no access token supplied'));
      return;
    }

    try {
      const { sub, role } = verifyAccessToken(token);
      socket.data.userId = sub;
      socket.data.role = role;
      next();
    } catch {
      next(new Error('UNAUTHORIZED: invalid or expired access token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data as { userId: string; role: Role };

    // Personal room, so the server can push notifications (Sprint 2 Day 10) to
    // a specific user across all their open tabs.
    void socket.join(`user:${userId}`);

    /**
     * Join a contract workspace room (Sprint 5 chat/live status).
     * Membership is authorised against the database on every join — the token
     * proves who you are, not which contracts you may watch.
     */
    socket.on('contract:join', async (contractId: string, ack?: (ok: boolean) => void) => {
      try {
        const contract = await prisma.contract.findUnique({
          where: { id: contractId },
          select: { clientId: true, freelancerId: true },
        });
        const isParty =
          contract && (contract.clientId === userId || contract.freelancerId === userId);
        if (isParty || role === 'ADMIN') {
          await socket.join(`contract:${contractId}`);
          ack?.(true);
        } else {
          ack?.(false);
        }
      } catch {
        ack?.(false);
      }
    });

    if (!env.isProduction) console.log(`[ws] connected: ${userId}`);

    socket.on('disconnect', (reason) => {
      if (!env.isProduction) console.log(`[ws] disconnected: ${userId} (${reason})`);
    });
  });

  return io;
}
