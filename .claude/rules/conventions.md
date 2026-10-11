# Rule: Code conventions

See `../.claude/rules/shared-conventions.md` for the cross-service baseline (imports, Zod
validation, secrets, style, messages, Swagger, logging). This file only covers what's specific
or different in third-service.

- **Auth**: routes are guarded globally by `JwtAuthGuard`, `LanguageGuard`, and
  `TokenBucketGuard` (all three registered as `APP_GUARD` in `app.module.ts`, in that order).
  `@Public()` for intentionally open endpoints — none of the `uploads` routes or the `email`
  test route are `@Public()` any more (gateway reaches this service over RMQ, and the UI only
  calls gateway's `/upload`). **No fallback JWT secret**: always read it through
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
- **Swagger tags in `main.ts` are stale** — the `DocumentBuilder` tag list still includes
  `Users`/`Auth`/`Students`/`Curriculum`/`Classes`/`Categories`/`Wallets`/`Transactions`/etc.
  from when this file was copied from another service's `main.ts`. The only tags actually used
  by a `@ApiTags(...)` decorator in this repo are `Notifications`, `Upload`, `Health`, `Redis`
  (and `Emails`, implicitly, if added). Trim stale tags when you're already touching `main.ts`
  for something else — not worth a standalone task on its own.
- **Request-log redaction**: `TraceContextInterceptor` never stores the body/response of `log.*`,
  `redis.*` or `email.*` RPCs (they carry sessions and reset tokens) and redacts
  `token`/`value`/`resetToken`/`secret`/`authorization` etc. elsewhere — add new secret-bearing
  field names to its `SENSITIVE_KEYS`.
- **Redis**: `RedisService` rejects an empty key, a non-string value, and a `ttlSeconds` that isn't a
  positive number (400) — a bad TTL must never create a key that never expires. Commands time out
  after 5s; `TokenBucketGuard` fails open (and keys by route pattern) when Redis is down.
- **Never log connection strings/secrets** (e.g. `DATABASE_URL`), and never use `redis KEYS` —
  use `SCAN` + `MGET` (see `health.redis` in `app.controller.ts`). HTML emails must
  `escapeHtml` user-supplied values.
- **`cloudinary` is an unused dependency** — file uploads go through Cloudflare R2
  (`@aws-sdk/client-s3` against an R2 endpoint), not Cloudinary. Don't add Cloudinary code
  expecting it to be wired up; it isn't.
