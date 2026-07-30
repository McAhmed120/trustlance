/**
 * Types shared between the API and the web app.
 *
 * Rule for this package: transport shapes only — what actually crosses the
 * wire. No Prisma types, no server internals. If a field must never reach the
 * client (passwordHash, tokenHash), it must not appear here.
 */

export * from './auth.js';
export * from './user.js';
export * from './marketplace.js';
