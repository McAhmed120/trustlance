# Working on TrustLance

## Local setup

```bash
docker compose up -d          # Postgres + Redis
npm install
cp .env.example .env          # then fill in secrets — see README
npm run db:migrate
npm run dev                   # api :4000, web :3000
```

## Commands

| Command | Does |
|---|---|
| `npm run dev` | API and web together |
| `npm test` | Jest + Supertest against `trustlance_test` |
| `npm run lint` / `npm run typecheck` | All workspaces |
| `npm run build` | Production build of every workspace |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Drop and re-migrate (destroys local data) |
| `npm run keys` | Generate an Ed25519 signing keypair |
| `npm run e2e` | API journey (servers must be running) |
| `npm run e2e:ui` | Browser tour + screenshots |
| `npm run e2e:avatar-theme` | Avatar upload + theme suite |

## Before opening a PR

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

CI runs the same, plus a check that no secret is tracked.

## House rules

**Money is integer cents.** Everywhere. Validate at the boundary; convert for display only.

**Never write a compensating row inside a transaction you are about to abort.** The throw
rolls it back. Classify inside the transaction, act outside it. See
[ARCHITECTURE.md §2](ARCHITECTURE.md#rule-3--never-write-a-compensating-row-inside-a-transaction-you-are-about-to-abort).

**Do not add a cached balance column.** Balances are summed from the append-only ledger by
design. If you genuinely need one, it must be written inside the same transaction as the
ledger row.

**New escrow transitions go in the transition table first.** The UI derives its buttons from
the same states, so an undeclared transition simply cannot be reached from the interface.

**Validate at the boundary with Zod, and use `.strict()`** on anything a user can PATCH.
Silently dropping unknown keys is how a `trustScore: 999` eventually gets through.

**Re-authorise ownership, not just role.** Every client is a `CLIENT`; only one of them owns
a given job.

## Adding a migration

```bash
# edit apps/api/prisma/schema.prisma, then:
npm run db:migrate -w @trustlance/api -- --name short_description
```

Stop the dev server first — a running Prisma client holds a lock on the query engine on
Windows, and migrations take an advisory lock that a killed process can leave behind.

## Secrets

`.env`, the signing private key, `uploads/` and `node_modules/` are gitignored and must stay
that way. CI fails the build if any is ever tracked.

Rotate any secret that has sat in a local `.env` before using it in production, and never
rotate the signing key without publishing the previous public key — historical records
verify against the key that signed them.

## Testing notes

Tests run against a separate `trustlance_test` database and clean **before** each test, not
after: after-cleanup leaves the database dirty when a test fails midway.

Prefer assertions that would fail if the feature were broken. Counting elements is not
enough — an avatar test once passed against an image that rendered as nothing, because the
fixture was a valid but fully transparent PNG.
