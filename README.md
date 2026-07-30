<div align="center">

# TrustLance

**Portable reputation and milestone escrow for freelancers.**

Every completed milestone produces a cryptographically signed work record that the
freelancer owns, can export, and can prove authentic anywhere — even if this platform
disappears.

[Architecture](#architecture) · [How it works](#how-it-works) · [Getting started](#getting-started) · [API](#api-reference) · [Testing](#testing)

</div>

---

## The problem

Freelance platforms keep reputation inside their own database. Years of five-star reviews
are worth nothing the moment a freelancer moves platform, works directly with a client, or
has an account wrongly flagged. On the payment side, milestone disputes are settled by
opaque, platform-controlled arbitration with no visibility into how a decision was reached.

TrustLance attacks both halves:

| | |
|---|---|
| **Reputation you own** | Approving a milestone mints an Ed25519-signed JSON document. Anyone can verify it with a public key — no API call, no account, no trust in a live database. |
| **Escrow you can audit** | Funds move through an append-only ledger driven by an explicit state machine. Balances are *derived* by summing the ledger, so they cannot drift. |
| **Evidence-based disputes** | Either party can escalate. Chat, files and tamper-evident time logs are bundled automatically for the arbitrator, who rules with a transparent percentage split. |

> **Escrow is simulated.** No real money moves anywhere in this build. Wallet balances are
> demo values so the full engine can be exercised end to end.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 | Server components where they help, client islands where they don't |
| Backend | Node 22, Express 5, TypeScript | Express 5 auto-forwards async rejections, removing a whole class of unhandled-error bugs |
| Database | PostgreSQL 16 + Prisma | Relational integrity matters when rows represent money |
| Cache / queues | Redis 7 + BullMQ | Rate limiting, OAuth state, scheduled auto-release |
| Realtime | Socket.IO | Live milestone status, chat, notifications |
| Signing | `jose` (Ed25519 / JWS) | Standards-based signed JSON anyone can verify |
| Testing | Jest, Supertest, Playwright | Unit → integration → real-browser |

---

## Getting started

**Prerequisites:** Node 22+, Docker Desktop.

```bash
# 1. Databases
docker compose up -d

# 2. Install and configure
npm install
cp .env.example .env

#    Generate the two JWT secrets (run twice, paste each into .env)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

#    Generate the Ed25519 signing keypair, paste the output into .env
npm run keys

# 3. Migrate and run
npm run db:migrate
npm run dev
```

| URL | What |
|---|---|
| http://localhost:3000 | Web app |
| http://localhost:3000/verify | Public record verifier — no login required |
| http://localhost:4000/health | Dependency health (503 if Postgres or Redis is unreachable) |
| http://localhost:4000/api/docs | Interactive OpenAPI reference (development only) |

### Try the whole flow

Open two browser profiles so you can be both parties at once:

1. Register a **client** in one, a **freelancer** in the other
2. Client: top up the demo wallet → post a job
3. Freelancer: submit a proposal
4. Client: accept it and split the amount into milestones → fund the first one
5. Freelancer: start work, log time, submit the deliverable
6. Client: approve and rate it → escrow releases and a signed record is minted
7. Freelancer: export the reputation bundle from `/profile`
8. Paste it into `/verify` **in a private window** — it verifies with no account at all

---

## Architecture

```
trustlance/
├── apps/
│   ├── api/                     Express 5 + Prisma
│   │   └── src/
│   │       ├── modules/         auth · users · jobs · proposals · contracts
│   │       │                    escrow · reputation · workspace · notifications
│   │       ├── middleware/       requireAuth · requireRole · validate · rate-limit
│   │       ├── jobs/            BullMQ auto-release worker
│   │       ├── realtime/        Socket.IO (authenticated at the handshake)
│   │       └── docs/            OpenAPI document
│   └── web/                     Next.js 16 App Router
│       └── src/
│           ├── app/             routes
│           ├── components/      design system + feature components
│           ├── lib/             API client, hooks
│           └── stores/          Zustand auth store
├── packages/
│   └── shared-types/            transport types shared by both apps
├── e2e/                         API journey + browser suites
└── scripts/                     signing-key generation
```

Each service is a logical module inside one Express app with clean internal boundaries —
not microservices. Splitting is a decision for when there's a reason, not a starting point.

---

## How it works

### The escrow state machine

```
CREATED ──fund──→ FUNDED ──start──→ IN_PROGRESS ──submit──→ SUBMITTED
   │                 │                    ↑                     │
   │                 │                    └──request-changes────┤
   ├──cancel──→ CANCELLED ←──cancel───────┘                     │
   │                                                    approve │
   └────────────── dispute ──→ DISPUTED ──resolve──→ RESOLVED   ↓
                                                            RELEASED
```

Every transition takes a `SELECT … FOR UPDATE` row lock on the milestone and commits its
ledger row in the same transaction. Anything not in the transition table is rejected with
`409 INVALID_TRANSITION`.

Two transitions exist that a naive reading of the spec would miss:

- **A rework loop** (`SUBMITTED → IN_PROGRESS`). "Client requests changes" is the most
  common real-world outcome; without it, the only options are approve or dispute.
- **Either party can dispute** — not just the client. A freelancer facing a client who
  has gone quiet after funding needs recourse too.

### The ledger has no balance column

Every balance — wallet, escrow, in-flight totals — is a `SUM` over the append-only
`escrow_transactions` table. There is no separately maintained number to drift out of
sync, which makes double-release *structurally* impossible rather than defended against.
Rows are never updated or deleted.

`approve` is the hinge of the whole system. One transaction:

1. writes the `RELEASE` ledger row
2. flips the milestone state
3. mints and stores the signed work record
4. completes the contract if it was the last milestone

Any failure means none of it happened.

### Portable reputation

On approval the server signs a JSON document with the platform's Ed25519 key:

```json
{
  "v": 1,
  "platform": "trustlance",
  "freelancerId": "…", "clientId": "…", "contractId": "…", "milestoneId": "…",
  "title": "Signing service and key management",
  "amountCents": 70000,
  "rating": 5,
  "completedAt": "2026-07-30T01:48:09.000Z"
}
```

`POST /api/reputation/verify` checks a record against the **public key only** and reads no
table — the same check any third party can run offline. `/verify` is a public page proving
exactly that. The JWS carries a `kid` header so keys can rotate without invalidating
history.

### Tamper-evident time logs

`hash = SHA256(canonical entry data + prevHash)`. Entries are append-only — stopping a
timer *creates* a row, never edits one — so the chain is intact by construction. It is
re-verified on every read, and the UI shows a "chain verified" indicator plus each entry's
hash prefix.

---

## Security

The decisions worth knowing before touching auth code.

**Refresh-token rotation with reuse detection.** Refresh tokens are opaque random strings
(a self-validating JWT cannot be revoked), stored only as SHA-256 hashes. Every refresh
issues a new token and revokes its predecessor. Presenting an *already-used* token means it
leaked, so the entire token family is revoked.

> The compensating revocation is committed **outside** the classifying transaction. Doing it
> inside means the subsequent `throw` rolls it back — the endpoint returns 401 while the
> stolen family stays fully usable. A test pins this by asserting the *victim's* token dies,
> not just the replayed one.

> `Serializable` isolation makes write conflicts an expected outcome, not an error. The
> rotation path retries `P2034` with backoff; choosing Serializable and not retrying is how
> a concurrent refresh becomes a 500.

**Token storage.** The access token lives in memory only — never `localStorage`, which any
XSS can read. The refresh token is an httpOnly, `SameSite=Strict` cookie scoped to
`/api/auth`.

**No account enumeration.** Login always runs a bcrypt comparison — against a dummy hash
when the email is unknown — and returns an identical error for unknown email, wrong
password, and OAuth-only account.

**Passwordless accounts.** OAuth users have a null `passwordHash`, which is explicitly
rejected rather than treated as "matches anything".

**No self-provisioned arbitrators.** Registration accepts only `FREELANCER` or `CLIENT`.
`ADMIN` grants the power to split escrow and is provisioned out of band.

**Trust score is not user-writable.** It is computed from completed work; the profile
endpoint uses a `.strict()` schema that rejects unknown keys outright.

**Ownership, not just role.** Every contract-scoped route re-authorises against the
database, and Socket.IO room joins are checked per join — the token proves who you are, not
which contracts you may watch.

**Ledger invariant.** `approve` asserts that escrow held equals the milestone amount before
releasing. A mismatch fails loudly rather than paying out a wrong number.

### Google sign-in (optional)

Full server-side authorization-code flow with PKCE. State is single-use in Redis, the ID
token's signature is verified against Google's JWKS, and unverified provider emails are
refused (linking on one would let someone claim a mailbox they don't control).

Leave `GOOGLE_CLIENT_ID` blank to disable — the API reports the provider as unconfigured
and the UI hides the button entirely. Setup instructions are in `.env.example`.

---

## API reference

Interactive docs at `/api/docs` in development. Representative endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` · `/login` · `/refresh` · `/logout` | Session lifecycle |
| `GET` | `/api/auth/oauth/google/start` | Begin federated sign-in |
| `GET/POST` | `/api/jobs` | List / create job postings |
| `POST` | `/api/jobs/:id/proposals` | Submit a proposal |
| `POST` | `/api/proposals/:id/accept` | Convert proposal → contract with milestones |
| `POST` | `/api/milestones/:id/fund` | Client funds escrow |
| `POST` | `/api/milestones/:id/submit` | Freelancer submits deliverable |
| `POST` | `/api/milestones/:id/approve` | Approve → release + mint signed record |
| `POST` | `/api/milestones/:id/dispute` | Either party escalates |
| `POST` | `/api/disputes/:id/resolve` | Arbitrator decision (percentage split) |
| `GET` | `/api/reputation/:userId/export` | Download signed record bundle |
| `POST` | `/api/reputation/verify` | Verify a record with no database access |
| `WS` | `contract:join` | Live chat, timer and status events |

---

## Testing

```bash
npm run lint && npm run typecheck   # all workspaces
npm test                            # 54 unit + integration tests
npm run e2e                         # 45-check API journey  (servers must be up)
npm run e2e:ui                      # 33-check browser tour + screenshots
npm run e2e:avatar-theme            # 20-check avatar upload + theme suite
```

`npm run e2e` walks signup → job → proposal → contract → fund → submit → approve → export →
verify → dispute → resolve, and finishes on a **money-conservation assertion**: every cent
deposited is either in a wallet or in escrow, never created or destroyed.

The browser suites drive real Chromium sessions and assert on rendered output — a signed
record verifying with no account, a tampered record failing, escrow freezing on dispute.

---

## Configuration

All variables are documented in `.env.example`. The essentials:

| Variable | Notes |
|---|---|
| `DATABASE_URL` / `TEST_DATABASE_URL` | Tests use a separate database and drop it freely |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Must differ from each other; ≥32 chars, enforced at boot |
| `SIGNING_PRIVATE_KEY` / `SIGNING_PUBLIC_KEY` | Ed25519, base64 PEM. Generate with `npm run keys` |
| `SIGNING_KEY_ID` | Becomes the JWS `kid`, so keys can rotate |
| `AUTO_RELEASE_DAYS` | Client silence before escrow auto-releases |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional; blank disables the provider |

Environment is validated with Zod at startup, so a missing secret is a readable boot
failure rather than a 500 weeks later.

**`.env` is never committed.** Neither is the signing private key, uploaded files, or
`node_modules` — see `.gitignore`. CI additionally fails the build if any of them are ever
tracked.

---

## Known limitations

Named deliberately rather than hidden:

- **Portability proves authorship, not truth.** A record proves *TrustLance asserted this*,
  not that the work happened. Closing that gap needs the client to co-sign at approval.
- **No revocation.** Once exported, a JWS is permanent. Any revocation list would
  reintroduce the live-database dependency the design exists to remove.
- **Arbitration is centralised.** Rulings are recorded permanently, but signing them the way
  work records are signed would make them properly non-repudiable.
- **The hash chain has no external witness.** It detects casual edits, not an attacker with
  database write access who recomputes the chain forward. Anchoring the chain head publicly
  would close it.
- **Escrow is simulated.** Stripe Connect is the path to real payments.
- **Email is logged, not sent.** The verification link is written to the server log; swap in
  a mail provider at that one call site.

---

## Deployment

See [DEPLOY.md](DEPLOY.md). CI (`.github/workflows/ci.yml`) runs lint, typecheck and the
full test suite against real Postgres and Redis service containers, and fails if a secret is
ever committed.

⚠️ The refresh cookie is `SameSite=Strict`, so the API and web app must share a registrable
domain. `localhost:3000` / `localhost:4000` are fine; `something.vercel.app` +
`something.railway.app` are different sites and the cookie will not be sent.

---

## License

MIT
