FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/analysis/package.json packages/analysis/package.json
COPY packages/review/package.json packages/review/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @repo/db exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter web build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app ./
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]