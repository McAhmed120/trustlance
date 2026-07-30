# Multi-stage build for the TrustLance API.
# Built from the MONOREPO ROOT, not from apps/api:
#   docker build -f apps/api/Dockerfile -t trustlance-api .
# The workspace layout means the build context has to include packages/.

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app

# Copy only manifests first so `npm ci` is cached and does not re-run on every
# source change.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN npm ci

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .

RUN npm run build -w @trustlance/shared-types \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @trustlance/api

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Drop root. The node image ships an unprivileged `node` user for this.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json

EXPOSE 4000

# Reports unhealthy when Postgres or Redis is unreachable, not merely when the
# process has exited — /health returns 503 in that case.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run at boot so a deploy can never serve traffic against an
# out-of-date schema. `migrate deploy` never generates new migrations.
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/server.js"]
