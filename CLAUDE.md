# CLAUDE.md — third-service

## Project Overview

`third-service` is one of four independent NestJS 11 + TypeScript repos in a tutoring-platform
backend (`gateway`, `user`, `tutor-service`, `third-service`). It owns the platform's
**infra/utility features**: transactional email (Resend), in-app notifications (Postgres via
Drizzle ORM), and file uploads (Cloudflare R2 via the S3 API, with Sharp for image resizing). It
also runs a RabbitMQ RMQ listener (`third_queue`) whose `@MessagePattern` responders the other
services call — including generic `redis.get`/`redis.set`/`redis.del` KV patterns (e.g. `user`
stores login sessions and reset-password tokens through them).

**This is not the education domain** (that's `tutor-service`: class/schedule/session/curriculum)
and **not auth/user/admin/student** (that's `user`). See
`../.claude/rules/architecture.md` for how the four repos fit together.

## IMPORTANT: Selective File Reading

**Do NOT read entire source code.** Only read files necessary for the current task:

### When working on a feature:
1. Read `CLAUDE.md` and `.claude/rules/*.md` for conventions
2. Read the specific feature module: `src/features/{name}/*`
3. Read related entities (only `notification` has one): `src/packages/entities/notification/*`
4. Read `src/database/schema.ts` only if touching the `notifications` table
5. Read `app.module.ts` only when registering new modules

### When fixing a bug:
1. Read the specific file with the bug
2. Read related files only if needed for context
3. Do NOT read unrelated features

### Files to read ONLY when necessary:
- `src/main.ts` — Only when changing bootstrap/microservice configuration
- `src/app.module.ts` — Only when adding/removing modules
- `src/database/schema.ts` — Only when modifying the `notifications` table (see the warning in
  `.claude/rules/database.md` about the rest of this file)
- `src/packages/helpers/*` — Only when using specific helpers
- `src/data/constants/*` — Only when adding error/success messages

## Tech Stack

| Layer            | Technology                                                        |
| ---------------- | -------------------------------------------------------------------- |
| Framework        | NestJS 11                                                          |
| Language         | TypeScript 5                                                       |
| Database         | PostgreSQL via Drizzle ORM + `postgres.js` — used by **only** the `notification` feature |
| Cache            | Redis (`ioredis`) — exposed to other services via the `redis.*` RPC patterns |
| Messaging        | RabbitMQ — RMQ microservice listener (`third_queue`) with `@MessagePattern` responders on all 4 features (no pub/sub) |
| Email            | Resend (`resend` package) — **not** Nodemailer despite the dependency being present |
| File storage     | Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3`, image resizing via `sharp` |
| Validation       | Zod v4 (via custom `ZodValidationPipe`) — only `notification` has schemas |
| API Docs         | @nestjs/swagger                                                    |
| Package Manager  | Bun (runtime) / npm (lock file present)                            |
| Testing          | Jest + Supertest — there is no separate Bun-native test runner; `bun run test` just runs Jest |
| Formatting       | Prettier (single quotes, trailing commas)                          |
| Linting          | ESLint + typescript-eslint                                          |
| Containerization | Docker Compose / Podman Compose                                    |

`cloudinary` is a dependency but is **not actually used** anywhere in `src/` (only referenced as
a leftover Swagger tag in `main.ts`) — file uploads go through Cloudflare R2, not Cloudinary.

## Commands

```bash
# Development
bun start:dev             # Start dev server with watch (port 8888) + RMQ listener on third_queue
bun start:debug           # Start with debug + watch
bun run build             # Production build
bun run start:prod        # Run compiled JS

# Code Quality
bun run lint              # ESLint with --fix
bun run lint:check        # ESLint without fix (CI-friendly)
bun run format            # Prettier write
bun run format:check      # Prettier check

# Testing
bun run test              # Jest unit tests
bun run test:watch        # Watch mode
bun run test:cov          # Coverage
bun run test:e2e          # E2E tests (Supertest)

# Database (Drizzle) — only the `notifications` table is actually owned/used here
bun run db:generate       # Generate migration SQL from schema changes
bun run db:migrate        # Run pending migrations
bun run db:push           # Push schema directly (dev only)
bun run db:studio         # Open Drizzle Studio

# Containers
bun compose:up            # Docker Compose up -d
bun compose:down          # Docker Compose down
bun podman:up             # Podman Compose up -d
bun podman:down           # Podman Compose down
```

## Project Structure

```
src/
├── main.ts                       # Bootstrap: CORS, interceptors, filters, RMQ listener (third_queue), listen
├── app.module.ts                 # Root module
├── app.controller.ts             # Health-check controller (+ `health.redis` RPC)
├── app.service.ts                # Health check
├── database/
│   ├── database.module.ts        # Global Drizzle provider (postgres.js), DRIZZLE token
│   └── schema.ts                 # See .claude/rules/database.md — only `notifications` (+ `users`
│                                  # for FK refs) is actually queried; the rest is vestigial
├── features/
│   ├── email/                    # Stateless: EmailController (health-check-ish test route) +
│   │   │                         # EmailService wrapping Resend. No repository, no entities.
│   │   ├── email.controller.ts
│   │   ├── email.rpc.controller.ts # @MessagePattern('email.*') mirror, reached via gateway RPC
│   │   ├── email.service.ts
│   │   └── email.module.ts
│   ├── notification/             # The one fully-layered feature: controller → service →
│   │   │                         # repository → module, backed by the `notifications` table.
│   │   │                         # `NotificationModule` is registered in `app.module.ts`.
│   │   ├── notification.controller.ts
│   │   ├── notification.rpc.controller.ts # @MessagePattern('notification.*') mirror
│   │   ├── notification.service.ts
│   │   ├── notification.repository.ts
│   │   └── notification.module.ts
│   ├── uploads/                  # Cloudflare R2 file storage. Provider/interface pattern, not
│   │   │                         # controller→service→repository — no DB, no entities.
│   │   ├── upload.controller.ts
│   │   ├── upload.rpc.controller.ts # @MessagePattern('upload.*') mirror
│   │   ├── upload.service.ts
│   │   ├── upload.provider.ts    # S3Client factory (Cloudflare R2 endpoint)
│   │   ├── upload.interface.ts
│   │   └── upload.module.ts
│   ├── redis/                    # Redis service wrapper (ioredis); also has redis.rpc.controller.ts
│   │                              # (@MessagePattern('redis.*') mirror)
│   ├── test-scenario/            # Admin-managed test cases per gateway endpoint + the engine that
│   │                              # runs them: `testscenario.create|list|update|delete|stats|run`
│   │                              # (`test-scenario.rpc.controller.ts` only — no HTTP controller;
│   │                              # gateway's thin `/test-scenarios` proxy reaches it). `run` fires a
│   │                              # REAL request at `GATEWAY_BASE_URL` with a fresh `x-correlation-id`
│   │                              # (so it lands in `request_logs` like organic traffic) and records
│   │                              # a `test_runs` row (pass ⇔ actualStatus === expectedStatus).
│   │                              # `wait: false` (gateway `?async=true`) returns `{ correlationId }`
│   │                              # at once and records the run in the background. Tables
│   │                              # `test_scenarios`/`test_runs` live in gateway's `schema.ts`.
│   └── log/                      # Owns `request_logs` (centralized cross-service request logging —
│                                  # see gateway's `LogController` for the admin-facing read API).
│                                  # log.controller.ts (HTTP, admin) + log.rpc.controller.ts
│                                  # (`log.create`/`log.query`/`log.trace`, reached by every
│                                  # service's LoggerInterceptor/TraceContextInterceptor via
│                                  # `@packages/context/log-sink`) → log.service.ts →
│                                  # log.repository.ts. log.gateway.ts is this repo's FIRST
│                                  # WebSocket gateway (`@WebSocketGateway({ namespace: '/logs' })`,
│                                  # JWT-in-handshake auth + role ADMIN, mirrors tutor-service's
│                                  # `ChatGateway` pattern) — emits `log:new` right after
│                                  # `LogService.createInternal()` inserts a row, so the admin
│                                  # "Giám sát Request" FE page updates live. `socket.io`/
│                                  # `@nestjs/websockets` are genuinely used here now — don't
│                                  # assume they're vestigial like other unused deps in this repo.
└── packages/                     # Shared utilities (import via @packages/*)
    ├── decorators/                # @Public, @CurrentUser, @Roles, @ApiResponse
    ├── entities/notification/     # The only Zod schema/DTO domain in this repo
    ├── filters/                   # HttpExceptionFilter (global) + RpcExceptionFilter (bound
    │                              # per-controller on each `*.rpc.controller.ts`, never global)
    ├── guards/                    # JwtAuthGuard (global), RolesGuard, AdminRoleGuard,
    │                              # LanguageGuard, TokenBucketGuard (both also global, see app.module.ts)
    ├── helpers/                   # checkUuidValid, validateRequiredEnvs, etc.
    ├── interceptor/                # ResponseInterceptor, ErrorInterceptor, LoggerInterceptor
    ├── interfaces/                 # SendMailOptions, ApiResponseInterface
    └── pipes/                      # ZodValidationPipe

drizzle/                          # Generated SQL migrations (5 so far) — see database.md
scripts/seed-test-scenarios.ts    # Idempotent seed of `test_scenarios` (key endpoints, 3-6 cases each)
test/
├── jest-e2e.json
└── test-scenario.e2e-spec.ts     # `testscenario.run` against a local fake-gateway HTTP server
```

## Code Conventions

See `.claude/rules/conventions.md` (this repo) and `../.claude/rules/shared-conventions.md`
(cross-service baseline) for the full list. The short version:

- `@packages/*` import alias, Zod v4 validation via `ZodValidationPipe`, `ERROR_MESSAGES`/
  `SUCCESS_MESSAGES` constants, Prettier/ESLint auto-applied by a PostToolUse hook.
- **There is no single canonical feature shape here** — see
  `.claude/rules/nestjs-feature-pattern.md` for the three real shapes (`notification` = full
  4-layer; `email` = stateless service, no repo; `uploads` = provider/interface, no repo, no
  Zod entities) and pick whichever matches what you're building.
- Global guards, in order: `JwtAuthGuard` (JWT auth), `LanguageGuard`, `TokenBucketGuard` (rate
  limiting) — all three via `APP_GUARD` in `app.module.ts`.

### Request/Response Flow (HTTP features)

1. Request → global guards (`JwtAuthGuard` unless `@Public()`, then `LanguageGuard`,
   `TokenBucketGuard`)
2. Controller validates body/query via `ZodValidationPipe` (only `notification` has schemas;
   `email`/`uploads` routes take no validated body)
3. Controller → Service → (Repository → Drizzle → Postgres, `notification` only)
4. `ResponseInterceptor` wraps the result: `{ statusCode, message, data, timestamp, method, path }`
5. Errors: `ErrorInterceptor` + `HttpExceptionFilter`

### RabbitMQ (RPC responder)

`main.ts` binds an RMQ microservice listener to `third_queue`; `gateway` and `user` reach it
through their `RmqProducer`, which routes `redis.*`/`email.*`/`notification.*`/`upload.*` here.
All 4 features have a `@MessagePattern` responder (`email`/`notification`/`upload`/`redis`
`*.rpc.controller.ts`), each delegating to the same `*Service` class its HTTP controller uses;
`RpcExceptionFilter`/`TraceContextInterceptor` are global on the microservice. A handler called
with `send()` must return a non-undefined value. See `../.claude/rules/architecture.md` and the
`add-rpc-endpoint` skill (one level up) for adding a new pattern.

## Environment Variables

| Variable                                | Description                              |
| ---------------------------------------- | ------------------------------------------- |
| `NODE_ENV`, `PORT`                        | Standard NestJS bootstrap vars (`PORT` default `8888`) |
| `DATABASE_URL` or `POSTGRES_*`            | Postgres connection (only used by `notification`) |
| `JWT_SECRET`                              | Used to construct the global `JwtModule` (token verification only — this repo issues no tokens) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_ACCESS_EXPIRES_SECONDS` / `JWT_REFRESH_EXPIRES_SECONDS` | Read by shared `@packages` auth code, must match `user`'s |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_URL`                                              | Redis connection |
| `RABBITMQ_URL`                            | RabbitMQ connection — required at boot (local `amqp://admin:admin@localhost:5672`; Railway: RabbitMQ service private URL) |
| `THIRD_QUEUE`                             | Overrides the RMQ listener queue name (default `third_queue`) |
| `GATEWAY_BASE_URL`                        | Where `testscenario.run` fires its real requests (default `http://localhost:8888`) |
| `RESEND_API_KEY`                          | Required — `EmailService` throws at construction if missing |
| `MAIL_FROM`                               | Required — sender address for Resend        |
| `PASSWORD_RESET_URL_BASE`                 | Base URL used in the forgot-password email link (default `http://localhost:3000`) |
| `CLOUDFLARE_R2_ENDPOINT` / `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Required — `UploadService` throws "R2 not configured" without them |
| `CLOUDFLARE_R2_REGION`                    | Default `auto`                              |
| `CLOUDFLARE_R2_BUCKET`                    | Default `tutor`                             |
| `CLOUDFLARE_R2_PUBLIC_URL`                | Base URL used to build the public file URL returned from `upload` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL`, `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`, `BACKEND_URL` | Read by shared `@packages` OAuth strategy code — **not actually wired to any route in this repo** (no `auth` feature here); leftover from the shared `@packages` copy |

## Key Files to Know

- `src/main.ts` — Bootstrap, Swagger tag list (stale — see `.claude/rules/conventions.md`), RMQ
  microservice listener setup
- `src/features/redis/redis.rpc.controller.ts` — Reference RPC responder (generic KV patterns)
- `src/features/notification/*` — The only full controller→service→repository→module feature
- `src/features/log/log.gateway.ts` — This repo's first WebSocket gateway (`/logs`, admin-only
  realtime feed of new `request_logs` rows)
- `src/features/uploads/upload.provider.ts` — S3Client factory for Cloudflare R2
- `src/features/email/email.service.ts` — Resend wrapper
- `src/packages/guards/` — `JwtAuthGuard`, `LanguageGuard`, `TokenBucketGuard` (all three global)

## Project Rules

The following rule files are loaded as part of these instructions and must be followed:

@.claude/rules/nestjs-feature-pattern.md
@.claude/rules/database.md
@.claude/rules/conventions.md

Cross-service rules (RPC contract, shared conventions baseline) live one level up:
`../.claude/rules/architecture.md`, `../.claude/rules/shared-conventions.md`.

## Automated Hooks

Configured in `.claude/settings.json` (scripts in `.claude/hooks/`):

- **PreToolUse (Write|Edit)** → `guard-paths.mjs` blocks edits to `.env*` and generated
  `drizzle/**` files.
- **PostToolUse (Write|Edit)** → `format-ts.mjs` runs prettier + eslint `--fix` on the
  touched `.ts/.js` file.
- **Stop** → `review-skills.mjs` runs after each task that changed `src/`, and asks Claude to
  review/update `.claude/rules/**`, `.claude/skills/**`, `.claude/agents/**`, and memory
  (`MEMORY.md` + memory files) so they stay in sync with new or changed patterns/facts. Fires
  once per distinct `src/` change state; the last-reviewed state is cached in
  `.claude/.cache/skill-review-state` (gitignored).
