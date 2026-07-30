# Architecture

Design notes for anyone extending TrustLance. The README covers *what* it does; this covers
*why it is built this way*, and the traps that bite when changing it.

---

## 1. Data model

```
User ──┬── Profile                    display name, bio, skills, rate, avatar
       ├── RefreshToken[]             rotating sessions, hashed
       ├── OAuthAccount[]             federated identities
       ├── Job[]            (client)
       ├── Proposal[]       (freelancer)
       ├── WorkRecord[]     (freelancer)
       └── Notification[]

Job ── Proposal ── Contract ── Milestone ──┬── EscrowTransaction[]
                       │                   ├── Dispute[]
                       │                   └── WorkRecord
                       ├── Message[]
                       ├── TimeEntry[]
                       └── FileAttachment[]
```

### Conventions that are not optional

**Money is always integer cents.** Never a float, at any layer. Validation rejects
non-integers at the API boundary so a `49.99` can never leak downstream. The UI converts to
dollars for display only.

**Timestamps are `timestamptz`.** Prisma defaults `DateTime` to `timestamp without time
zone`. For a system whose premise is auditable records — signed `completedAt`, ledger
ordering — that is a latent bug, and migrating a populated ledger later is painful.

**Milestones carry an explicit `position`.** Milestones in one plan are created in a single
transaction and share `createdAt` to the millisecond, so ordering by timestamp is
non-deterministic and renders the plan out of order.

---

## 2. The escrow engine

`apps/api/src/modules/escrow/escrow.service.ts` is the most safety-critical file in the
project. Four rules govern it.

### Rule 1 — one transaction, one row lock

Every transition runs inside a transaction that opens with:

```sql
SELECT id FROM milestones WHERE id = $1 FOR UPDATE
```

That lock is the serialization point for all of escrow. Concurrent transitions — including
the auto-release worker racing a human dispute at the deadline — queue on it; the loser
re-reads state and gets a clean `INVALID_TRANSITION` instead of double-moving money.

### Rule 2 — the transition table is the only authority

```ts
CREATED     → FUNDED | CANCELLED
FUNDED      → IN_PROGRESS | DISPUTED | CANCELLED
IN_PROGRESS → SUBMITTED | DISPUTED
SUBMITTED   → RELEASED | IN_PROGRESS | DISPUTED   // includes the rework loop
DISPUTED    → RESOLVED
RELEASED / RESOLVED / CANCELLED → (terminal)
```

The UI derives its action buttons from the same states, so it can never offer a transition
the server would reject. `APPROVED` and `RELEASED` are deliberately collapsed: approval
writes the release row atomically, so a persisted "approved but not released" state cannot
exist to be recovered from.

### Rule 3 — never write a compensating row inside a transaction you are about to abort

This is the trap that has already bitten twice in this codebase.

```ts
// WRONG — the throw rolls back the revocation you just wrote
await prisma.$transaction(async (tx) => {
  await tx.thing.updateMany({ ...revoke });
  throw new ApiError(401, ...);          // ← undoes the line above
});

// RIGHT — classify inside, act outside
const outcome = await prisma.$transaction(async (tx) => classifyOnly(tx));
if (outcome.kind === 'reuse') {
  await prisma.thing.updateMany({ ...revoke });   // commits independently
  throw new ApiError(401, ...);
}
```

The refresh-token reuse path was silently broken this way: it returned a correct-looking
401 while the stolen token family stayed fully usable. Assume the same shape lurks anywhere
you throw after writing.

### Rule 4 — balances are derived, never stored

```ts
walletBalance(user)   = Σ(credits to user) − Σ(debits from user)
milestoneEscrow(m)    = Σ(FUND) − Σ(RELEASE + REFUND)
```

There is no balance column anywhere. Two sources of truth cannot drift when there is only
one. Adding a cached balance is the single fastest way to break this system — if you must,
it has to be written inside the same transaction as the ledger row, and reconciled.

`approve()` additionally asserts `escrowHeld === milestone.amountCents` before releasing.
If that trips, the ledger and state machine disagree and continuing would print money, so it
fails loudly with a 500 rather than paying out a wrong number.

### The wallet advisory lock

The milestone lock does not serialize the *wallet*. Two concurrent funds of different
milestones from one wallet could both read a sufficient balance. `fundMilestone` therefore
also takes:

```sql
SELECT pg_advisory_xact_lock(hashtext('wallet:' || $userId))
```

The same pattern serializes time-entry appends per contract, so two stops cannot claim the
same `prevHash`.

---

## 3. Authentication

### Token design

| | Access token | Refresh token |
|---|---|---|
| Format | JWT (HS256) | Opaque random, 48 bytes |
| Lifetime | 15 minutes | 7 days |
| Storage (client) | Memory only | httpOnly cookie, `SameSite=Strict`, `/api/auth` |
| Storage (server) | none | SHA-256 hash only |
| Revocable | no | yes |

The refresh token is deliberately **not** a JWT. A self-validating token cannot be revoked,
and revocation is the entire point: every refresh is a database lookup that consults
revocation state.

### Rotation and reuse detection

Each refresh issues a new token and revokes its predecessor, linking them via
`replacedByTokenId`. All tokens descended from one login share a `familyId`.

Presenting an already-revoked token means it leaked — someone is replaying a token the
legitimate client already exchanged. The response is to revoke the **entire family**,
logging out attacker and victim alike. Silently issuing a new token instead would let a
stolen token work indefinitely, which defeats rotation.

### Client-side single flight

If three requests 401 at once, three parallel refreshes would rotate the token three times —
and because rotation revokes the predecessor, two would look like *reuse* and burn the
family. `lib/api.ts` shares one in-flight refresh promise, and `bootstrapSession` reuses the
same promise rather than opening its own call.

---

## 4. Reputation signing

```
approve() ─┬─ RELEASE ledger row
           ├─ milestone → RELEASED
           ├─ sign claims with Ed25519 → compact JWS
           └─ store WorkRecord { jws, payload }
                    (all in one transaction)
```

The JWS is the product. `payload` is a convenience copy for rendering; the JWS is canonical.

Verification (`POST /api/reputation/verify`) touches **no table**. That is the whole claim:
the same check a third party runs offline with only the public key. If you ever find
yourself adding a database read to that path, the portability property is gone.

The protected header carries `kid`. Rotating the signing key without publishing the old
public key would invalidate every historical record, so key history must outlive key
rotation.

---

## 5. Realtime

Socket.IO authenticates **at the handshake**, not after connect. A socket allowed to connect
first is one that can already emit and consume resources.

Room membership is authorised per join against the database — the token proves who you are,
not which contracts you may watch:

```
user:<userId>          personal notifications, all tabs
contract:<contractId>  chat, timer, milestone status (parties + admins)
```

Server-pushed events invalidate TanStack Query caches rather than carrying payloads, so the
client re-fetches through the normal authorised path.

---

## 6. Frontend

**State ownership**
- Server state → TanStack Query (`lib/hooks.ts`)
- Auth/session → Zustand (`stores/auth.ts`) — the *user object* only
- The access token → a module-level variable in `lib/api.ts`, never in a store that could be
  persisted

**Theme** is an external store (localStorage + a `data-theme` attribute) read via
`useSyncExternalStore`, with a blocking inline script in `<head>` applying it before first
paint. A React effect runs after paint, which is exactly the white-flash bug.

**Design tokens** live in `globals.css` as CSS custom properties mapped through Tailwind v4's
`@theme inline`. Escrow state colours sit deliberately outside the accent system — if
"Released" shared a hue with ordinary UI it would stop reading as meaningfully different.

Two dark-mode traps: pairing a hard-coded `bg-white` with theme-dependent `text-foreground`
makes text invisible when `foreground` flips (a test now guards the known cases), and
Tailwind v4's `@apply` cannot apply another custom class — only real utilities.

---

## 7. Testing strategy

| Suite | Scope |
|---|---|
| `apps/api/src/__tests__` | Real Postgres + Redis. Mocks would not reproduce transaction isolation or unique constraints, which is precisely what is worth testing |
| `e2e/full-journey.mjs` | The whole product through HTTP, three independent sessions, ending on money conservation |
| `e2e/ui-tour.mjs` | Real Chromium, both parties, screenshots at every surface |
| `e2e/avatar-theme.mjs` | Upload, theme persistence, dark-mode contrast |

Tests clean **before** each run, not after: after-cleanup leaves a dirty database whenever a
test fails midway, which cascades into confusing failures in the next one.

A lesson worth keeping: a test that counts elements can pass against a broken feature. The
avatar suite once passed while the image rendered as nothing, because the fixture was a
valid but fully transparent PNG. It now asserts `naturalWidth > 0` — the image must actually
decode.
