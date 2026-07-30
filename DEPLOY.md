# Deployment — steps for you to run

Everything code-side is ready: CI workflow, Dockerfile, and health checks. The remaining steps need your accounts, so they're written out rather than done for you.

---

## 1. Create the GitHub repo and push

```bash
cd C:\Users\Kirit\trustlance

git add -A
git commit -m "Sprint 1: foundation, auth, profiles"

# Private is the right default — .env is gitignored, but a private repo means a
# future mistake isn't instantly public.
gh repo create trustlance --private --source=. --remote=origin --push
```

CI (`.github/workflows/ci.yml`) runs on the first push: lint, typecheck, tests against real Postgres and Redis, a web build, and a check that no `.env` or `.pem` is tracked.

---

## 2. Deploy the API (Railway)

Railway needs browser OAuth, so do this in the dashboard at [railway.app](https://railway.app).

1. **New Project → Deploy from GitHub repo → `trustlance`**
2. Add **PostgreSQL** and **Redis** from the "New" menu. Railway injects `DATABASE_URL` and `REDIS_URL` automatically.
3. On the API service → **Settings**:
   - **Root Directory**: `/` (the Dockerfile expects the monorepo root as build context)
   - **Dockerfile Path**: `apps/api/Dockerfile`
4. **Variables** — add these:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `API_PORT` | `4000` |
   | `JWT_ACCESS_SECRET` | generate below — **not** your local value |
   | `JWT_REFRESH_SECRET` | generate below — must differ from the access secret |
   | `CLIENT_ORIGIN` | your Vercel URL, e.g. `https://trustlance.vercel.app` |
   | `SIGNING_KEY_ID` | `trustlance-key-2026-01` |

   Generate each secret freshly:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

5. Deploy. Migrations run automatically at container start (`prisma migrate deploy`).

> `CLIENT_ORIGIN` is a chicken-and-egg with step 3 — deploy the API first, deploy the web app, then come back and set the real Vercel URL. CORS **and** the refresh cookie both depend on it being exact.

---

## 3. Deploy the web app (Vercel)

At [vercel.com](https://vercel.com) → **Add New → Project → import `trustlance`**.

- **Root Directory**: `apps/web`
- **Environment Variable**: `NEXT_PUBLIC_API_URL` = your Railway API URL (e.g. `https://trustlance-api.up.railway.app`)

Then go back to Railway and set `CLIENT_ORIGIN` to the Vercel URL, and redeploy the API.

---

## 4. Production smoke test

```bash
API=https://your-api.up.railway.app

curl -s $API/health          # {"status":"ok","db":true,"redis":true}
```

Then in the browser, on the live site:

1. Register an account → lands on the profile page
2. Edit and save the profile → shows "Saved"
3. **Hard-reload the page** → still logged in (proves the refresh cookie works cross-origin)
4. Log out → header returns to signed-out state

If step 3 fails, `CLIENT_ORIGIN` on Railway doesn't exactly match the Vercel origin. The cookie is `SameSite=Strict` and `Secure`, so it will not be sent over http or to a mismatched origin.

---

## Before going live with real users

Not blocking for a demo, but don't skip these later:

- [ ] Rotate any secret that ever sat in a local `.env`
- [ ] Set up scheduled pruning of expired `refresh_tokens` rows (the table grows on every login)
- [ ] Confirm `/api/docs` is not served — it is gated on `NODE_ENV !== 'production'`
- [ ] Point a real domain at Vercel and update `CLIENT_ORIGIN` again
