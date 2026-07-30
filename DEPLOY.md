# Deploying TrustLance

Everything code-side is ready: Dockerfile, health checks, CI, and configurable cookie
policy. The remaining steps need your accounts, so they're written out rather than
automated.

**Estimated time:** ~20 minutes. **Cost:** free tier on both platforms.

---

## The one thing that will break if you skip it

TrustLance authenticates with an httpOnly refresh cookie. Browsers only send that cookie
back if the cookie's `SameSite` policy allows it — and **a Vercel frontend calling a Railway
API are different *sites***.

Leave the default (`SameSite=Strict`) on a split deployment and the symptom is brutal to
debug: login returns 200, then the app immediately behaves as if you're logged out, forever.

| Your setup | `COOKIE_SAMESITE` |
|---|---|
| Frontend and API on **different** hosts (`x.vercel.app` + `y.railway.app`) | `none` |
| Both under one domain (`app.example.com` + `api.example.com`) | `strict` |
| Local development | `strict` (the default) |

`none` requires HTTPS, which both platforms give you. The API refuses to boot with
`COOKIE_SAMESITE=none` unless `NODE_ENV=production`, so you cannot half-configure it.

When `SameSite=None` is active, `/api/auth/refresh` and `/logout` additionally require a
custom request header. That closes the CSRF hole `None` opens — a foreign page could
otherwise trigger a token rotation and log you out. The web client sends it automatically.

---

## 1. Push to GitHub

Already done if you're reading this in the repo. If CI is missing, your token needs the
`workflow` scope:

```bash
gh auth refresh -s workflow
git add .github && git commit -m "Add CI workflow" && git push
```

---

## 2. Deploy the API (Railway)

At [railway.app](https://railway.app) — needs browser sign-in.

1. **New Project → Deploy from GitHub repo → `trustlance`**
2. Add **PostgreSQL** and **Redis** from the *New* menu. Railway injects `DATABASE_URL` and
   `REDIS_URL` automatically.
3. On the API service → **Settings**:
   - **Root Directory:** `/` — the Dockerfile expects the monorepo root as build context
   - **Dockerfile Path:** `apps/api/Dockerfile`
4. **Variables** — add these:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `API_PORT` | `4000` |
   | `JWT_ACCESS_SECRET` | generate below |
   | `JWT_REFRESH_SECRET` | generate below — must differ from the access secret |
   | `COOKIE_SAMESITE` | `none` (see the table above) |
   | `CLIENT_ORIGIN` | your Vercel URL — fill in after step 3 |
   | `API_PUBLIC_URL` | your Railway URL, e.g. `https://trustlance-api.up.railway.app` |
   | `SIGNING_PRIVATE_KEY` | from `npm run keys` |
   | `SIGNING_PUBLIC_KEY` | from `npm run keys` |
   | `SIGNING_KEY_ID` | e.g. `trustlance-key-2026-07` |

   Generate fresh secrets — **never reuse the ones from your local `.env`**:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # x2
   npm run keys                                                                     # signing pair
   ```

5. Deploy. Migrations run automatically at container start (`prisma migrate deploy`).

> **Chicken-and-egg:** `CLIENT_ORIGIN` needs the Vercel URL, which needs the API URL. Deploy
> the API first with a placeholder, do step 3, then come back and set the real value and
> redeploy. CORS *and* the cookie both depend on it being exact — no trailing slash.

---

## 3. Deploy the web app (Vercel)

At [vercel.com](https://vercel.com) → **Add New → Project → import `trustlance`**.

| Setting | Value |
|---|---|
| **Root Directory** | `apps/web` — click *Edit* beside Root Directory and select it |
| **Framework Preset** | Next.js (auto-detected) |
| **Build & Install Command** | leave as the default — do **not** override |
| **Environment Variable** | `NEXT_PUBLIC_API_URL` = your Railway API URL |

Leave the build command alone. `apps/web` has a `prebuild` script that compiles the
`shared-types` workspace package, and npm runs it automatically before `build`. Overriding
the build command skips it, and every import of `@trustlance/shared-types` then fails with
`Module not found`.

Then return to Railway, set `CLIENT_ORIGIN` to the Vercel URL, and redeploy.

### If the Vercel build fails

**`Module not found: Can't resolve '@trustlance/shared-types'`**
The workspace package was not compiled. Either the build command was overridden, or Root
Directory is not `apps/web`. Reset both to the values above.

**`No Next.js version detected`**
Root Directory is pointing at the repository root instead of `apps/web`.

**Build succeeds, but pages error at runtime**
`NEXT_PUBLIC_API_URL` is missing or wrong. It is inlined at build time, so changing it needs
a redeploy — restarting is not enough.

**CORS errors in the browser console**
`CLIENT_ORIGIN` on Railway must match the Vercel origin exactly: scheme, host, no trailing
slash.

---

## 4. Google sign-in (optional)

Skip entirely and the button simply won't render.

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. **APIs & Services → OAuth consent screen** → External → add yourself as a test user
3. **Credentials → Create credentials → OAuth client ID → Web application**
4. **Authorised redirect URI** — must match exactly:
   ```
   https://YOUR-API-HOST/api/auth/oauth/google/callback
   ```
5. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to Railway, then redeploy.

---

## 5. Smoke test

```bash
API=https://your-api.up.railway.app
curl -s $API/health        # {"status":"ok","db":true,"redis":true}
```

Then in a browser, on the live site:

1. Register → lands on the profile
2. Edit and save the profile → shows "Saved"
3. **Hard-reload** → still logged in ← *this is the cookie test; if it fails see below*
4. Post a job, accept a proposal, fund a milestone, approve it
5. Export the record, verify it at `/verify` **in a private window**

### If step 3 fails

The refresh cookie isn't coming back. In order of likelihood:

1. `COOKIE_SAMESITE` is still `strict` on a split-host deployment → set it to `none`
2. `CLIENT_ORIGIN` doesn't exactly match the Vercel origin (scheme, host, no trailing slash)
3. Not served over HTTPS — `SameSite=None` cookies require `Secure`

Open DevTools → Application → Cookies. If `trustlance_rt` isn't there after login, it's (1)
or (3). If it's there but not sent on `/api/auth/refresh`, it's (2).

---

## Before real users

Not blocking for a demo, but don't ship past these:

- [ ] Rotate any secret that ever sat in a local `.env`
- [ ] Schedule pruning of expired `refresh_tokens` rows — the table grows on every login
- [ ] Confirm `/api/docs` is not served (it is gated on `NODE_ENV !== 'production'`)
- [ ] Move uploads to object storage — Railway's container filesystem is ephemeral, so
      avatars and contract files are lost on redeploy
- [ ] Put a real domain in front of both, which also lets you drop back to
      `COOKIE_SAMESITE=strict`
