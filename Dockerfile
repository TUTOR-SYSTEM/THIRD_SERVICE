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
    PORT=4002 \
    THIRD_QUEUE=third_queue

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY package.json tsconfig.json ./
# Git commit this image was built from (passed as build arg by compose). Shown via
# `docker inspect` label and `GIT_COMMIT` env. Kept last so it doesn't bust earlier layers.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
LABEL org.opencontainers.image.revision=${GIT_COMMIT}

USER node
EXPOSE 4002
CMD ["node", "dist/main"]
