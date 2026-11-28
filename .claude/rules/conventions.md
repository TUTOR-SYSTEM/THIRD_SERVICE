# Rule: Code conventions

See `../.claude/rules/shared-conventions.md` for the cross-service baseline (imports, Zod
validation, secrets, style, messages, Swagger, logging). This file only covers what's specific
or different in third-service.

- **Auth**: routes are guarded globally by `JwtAuthGuard`, `LanguageGuard`, and
  `TokenBucketGuard` (all three registered as `APP_GUARD` in `app.module.ts`, in that order).
  HTTP controllers: `app` is class-level `@Public()` (health only). `email`, `log` and `redis` are
  JWT-guarded and ADMIN only via `@UseGuards(AdminRoleGuard)` (from `@packages/guards`); the review
  of 2026-11-23 replaced the earlier no-token exposure. RPC (`*.rpc.controller.ts`) is not HTTP, so
  the global guards never run on it and it is unaffected. Do not add `@Public()` to RPC handlers.
  `notification` and `upload` stay guarded by the global `JwtAuthGuard` (no `@Public()`; `upload` reads `@CurrentUser().role`/`id`, so it must have a token),
  because its handlers scope data by `@CurrentUser().id` and must not run without a user. **No fallback JWT secret**: always read it through
  `resolveJwtAccessSecret(configService)` (`@packages/configs/jwt-sign.config`), which throws when
  `JWT_ACCESS_SECRET`/`JWT_SECRET` is unset — never reintroduce a hard-coded default. There is no `admin`/`student`/`auth` feature in this repo — `@Roles`/
  `RolesGuard` exist in `@packages/guards` (shared package copy) but nothing here currently uses
  them.
- **Helpers actually used here** (`@packages/helpers`): `checkUuidValid` (FK validation in
  `NotificationService`), `validateRequiredEnvs` (`database.module.ts`). `generateCode`,
  `hashData`/`compareData`, `buildListWhereClause`, `signAccessToken`/`signRefreshToken` are
  present in the shared `@packages/helpers` copy but unused in this repo's actual feature code —
  don't reach for `buildListWhereClause` on a new list endpoint here; `notification`'s own
  inline `and()`/`eq()`/`ilike()` style is the local convention (see
  `.claude/rules/nestjs-feature-pattern.md`).
- **List response shape**: `{ data, pagination }` (see `NotificationRepository.findAll`) — the
  list key is `data`, not the resource name. This differs from `tutor-service`/`user`'s
  convention; match this repo's existing shape for consistency within it.
- **Swagger tags in `main.ts` must match `@ApiTags(...)` usage.** The `DocumentBuilder` tag list
  is trimmed to exactly the tags this repo's controllers use: `Email`, `Notifications`, `Upload`, `Logs`,
  `Health`, `Redis`. When you add or rename an `@ApiTags(...)`, add the matching `.addTag(...)`
  in `main.ts`; when you remove one, remove its tag too. The title is `Third Service API`.
  Only non-production builds expose Swagger (`NODE_ENV !== 'production'`).
- **Request logging removed (2026-11-28)**: the request-log pipeline (`log` feature, `request_logs` writes, `log-sink`, `LoggerInterceptor`) was deleted. Do not add request logging back. The `request_logs` table still exists in the schema and is unused.
- **Redis**: `RedisService` rejects an empty key, a non-string value, and a `ttlSeconds` that isn't a
  positive number (400) — a bad TTL must never create a key that never expires. Commands time out
  after 5s; `TokenBucketGuard` fails open (and keys by route pattern) when Redis is down.
- **JwtAuthGuard also checks the DB role** (2026-11-24): after the Redis session check it loads
  `isActive` + `role` and rejects (401) a token whose `role` differs from the user row.
- **Swagger is opt-in**: only when `NODE_ENV` is development/test or `ENABLE_SWAGGER=true` (unset
  `NODE_ENV` no longer exposes `/api-docs`). `main.ts` calls `app.enableShutdownHooks()`.
- **No raw error text to HTTP clients**: `ErrorInterceptor` always answers non-HTTP, non-constraint errors with
  "Internal server error" (real message only in logs). Seed scripts import `scripts/_guard-not-production.ts`.
  SMTP uses `requireTLS` when auth is set plus connection/socket timeouts; multer also caps `fields`/`parts`.
- **Don't use `ZodValidationPipe` for plain string params**: it JSON-parses strings; `generateCode` uses `crypto.randomInt`.
- **Size caps on free text**: notification `content` ≤ 5000, `metadata` ≤ 10KB — keep caps when adding fields.
- **Never log connection strings/secrets** (e.g. `DATABASE_URL`), and never use `redis KEYS` —
  use `SCAN` + `MGET` (see `health.redis` in `app.controller.ts`). HTML emails must
  `escapeHtml` user-supplied values.
- **`cloudinary` is an unused dependency** — file uploads go through Cloudflare R2
  (`@aws-sdk/client-s3` against an R2 endpoint), not Cloudinary. Don't add Cloudinary code
  expecting it to be wired up; it isn't.
