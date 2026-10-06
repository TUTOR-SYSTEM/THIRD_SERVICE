# --- BUILD ---- #
# node (not bun) runs `nest build`: under bun, nest's path-alias rewrite (@packages/*) is skipped
FROM node:22-alpine AS builder
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN node node_modules/@nestjs/cli/bin/nest.js build && test -f dist/main.js

# --- PROD DEPS: runtime-only node_modules ---
FROM oven/bun:1-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

# --- RUNTIME ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4001 \
    THIRD_QUEUE=third_queue

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY package.json tsconfig.json ./
USER node
EXPOSE 4001
CMD ["node", "dist/main"]
