# CreativeClaw Gateway — Production Dockerfile
# Multi-stage: build TypeScript → run compiled JS

# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace manifests first (better layer caching)
COPY package.json ./
COPY pnpm-workspace.yaml* ./
COPY tsconfig.base.json ./

# Copy all package.json files
COPY apps/gateway/package.json        apps/gateway/
COPY apps/dashboard/package.json      apps/dashboard/
COPY apps/cli/package.json            apps/cli/
COPY apps/worker-local/package.json   apps/worker-local/
COPY packages/core/package.json       packages/core/
COPY packages/errors/package.json     packages/errors/
COPY packages/jobs/package.json       packages/jobs/
COPY packages/memory/package.json     packages/memory/
COPY packages/protocol/package.json   packages/protocol/
COPY packages/observability/package.json packages/observability/
COPY packages/collaboration/package.json packages/collaboration/
COPY packages/connectors-adobe/package.json packages/connectors-adobe/
COPY packages/tool-registry/package.json packages/tool-registry/
COPY packages/action-executor/package.json packages/action-executor/
COPY packages/api-registry/package.json packages/api-registry/
COPY packages/search/package.json     packages/search/

# Install deps
RUN pnpm install --frozen-lockfile 2>/dev/null || npm install

# Copy source and build
COPY . .
RUN pnpm build 2>/dev/null || npm run build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder /app/dist                ./dist
COPY --from=builder /app/node_modules        ./node_modules
COPY --from=builder /app/apps/*/node_modules ./apps/
COPY --from=builder /app/package.json        ./

# Non-root user for security
RUN addgroup -S claw && adduser -S claw -G claw
RUN mkdir -p /home/claw/.creativeclaw && chown -R claw:claw /home/claw
USER claw

ENV NODE_ENV=production
ENV HOME=/home/claw

EXPOSE 3789

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3789/health | grep '"ok":true' || exit 1

CMD ["node", "dist/apps/gateway/src/index.js"]
