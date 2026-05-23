# Multi-stage Dockerfile for the Next.js app on Fly.io. The same image
# runs as either `web` (next start) or `worker` (npm run worker) via the
# process groups in fly.toml — they share the codebase + node_modules
# (including BullMQ/ioredis/aws-sdk + tsx for the TS worker entrypoint).

# ── deps: install full dependency tree (dev + prod) ──────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

# ── builder: prisma generate + next build ────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma 7's config loader resolves env("DATABASE_URL") at `generate`
# time. Real Fly secrets are runtime-only, so set a placeholder just for
# the build. `prisma generate` only emits client code — it doesn't
# connect — so the URL value is irrelevant.
ENV DATABASE_URL=postgres://placeholder@localhost/dummy
RUN npx prisma generate
# Next eslint flag — schema CI already lints; skip during build for speed.
ENV NEXT_DISABLE_ESLINT_DURING_BUILD=1
# Fly's default remote builder VM has ~2GB RAM; Next.js webpack build of
# this app pushes past it (heap OOM, SIGABRT). Raise the V8 heap ceiling.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

# ── runner: minimal-ish prod image ───────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Worker needs src/ + tsconfig + full node_modules (tsx, prisma client,
# bullmq, aws-sdk). Standalone Next.js output is included so `npm start`
# (server.js) works with the slim runtime.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
# fly.toml [processes] overrides this CMD per machine role.
CMD ["npm","start"]
