# Rule: Database & migrations

- **Never hand-edit anything under `drizzle/`** — those SQL files and `meta/` are generated.
  (A PreToolUse hook blocks this.) Change the schema in `src/database/schema.ts` instead.
- After editing `src/database/schema.ts`, run `bun run db:generate` to emit a migration, then
  tell the user to run `bun run db:migrate` (or `bun run db:push` for dev). Do not run
  destructive DB commands automatically.
- All tables use UUID primary keys (`.defaultRandom()`), snake_case column names mapped from
  camelCase TS properties, and `created_at`/`updated_at` timestamps. Declare enums as
  `pgEnum('name', [...])` at the top of `schema.ts`.

## Important: `schema.ts` is much bigger than what this repo actually uses

`src/database/schema.ts` defines the **entire education-domain table set** — `classes`,
`class_students`, `schedules`, `class_sessions`, `curriculums`, `chapters`, `lessons`,
`tuitions`, `student_scores`, `ai_messages`, `attendances`, `exercises`, `conversations`,
`conversation_participants`, `messages` — plus `users` and `grades`. This is the same schema
`tutor-service` owns. But **this repo's only real feature-backed table is `notifications`**
(`src/features/notification/*` is the only feature with a repository); nothing in
`src/features/` queries `classes`, `sessions`, `curriculums`, etc.

Treat the non-`notifications`/non-`users` tables here as **vestigial** — they exist in this
repo's schema file (and its Postgres database, if migrations were ever run against it) only
because the file was copied wholesale from `tutor-service` at some point, not because
third-service owns or should query that data. Concretely:

- **Don't add a repository method against `classes`/`sessions`/etc. from this repo.** If a
  notification (or any third-service feature) needs class/session data, that's a sign the
  request should go through the RPC contract to `tutor-service` (see
  `../.claude/rules/architecture.md`) once it has responders wired up — not a direct Drizzle
  query into a table this service doesn't semantically own.
- **The `notifications` table itself does reference `classes.id`/`users.id`** (`classId`,
  `studentId`, `userId`, `senderId` FKs) — those FK columns exist and are used by
  `NotificationRepository`, but the referenced rows are never read back through those tables
  from this repo; they're stored as opaque ids.
- If you're asked to trim `schema.ts` down to just `notifications` + `users` (the same cleanup
  `user`'s schema went through — see that repo's `[[trimmed-feature-set]]` memory for the
  pattern), that's a deliberate migration-generating change — confirm with the user first, don't
  do it as a side effect of an unrelated task.
- Enums (`classStatusEnum`, `sessionStatusEnum`, etc.) declared for those vestigial tables are
  likewise unused by any `src/features/` code — don't treat their presence as evidence a
  class/session feature exists here.

`drizzle/` already has 5 generated migrations reflecting this full schema — that's expected
given the above; it doesn't mean this repo runs code against all of it.

## Schema import gotcha (2026-09-29)

`src/database/database.module.ts` imports the shared schema with `import * as schema from
'@tutor/gateway/schema'`. Because of `esModuleInterop`, that namespace gets an extra `default`
key holding a null-prototype ESM namespace, and drizzle's `is()` crashes on it
(`Cannot read properties of null (reading 'constructor')`, logged misleadingly as "PostgreSQL
connect failed"). The module therefore strips `default` (`const { default: _default, ...tables }
= schema`) and passes `{ schema: tables }` to `drizzle()`. Keep that when touching the provider
(same fix lives in `user` and `tutor-service`). `request_logs` also gained `ip` and
`error_message` columns in gateway's schema — apply with `db:push` from gateway.
