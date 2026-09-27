---
name: generate-feature
description: Scaffold a complete NestJS feature module (entity schema/dto, controller, service, repository, module) following this project's exact conventions and wire it into app.module.ts. Use when the user asks to "create a feature", "generate a feature", "add a new module/CRUD", or "scaffold" for this NestJS infra/utility backend.
---

# Generate NestJS Feature

Scaffold a full feature module for `third-service` (this backend's infra/utility features:
email, notification, uploads, plus the Redis infra module).

**Before running the full layer-skill chain below, check whether a full 4-layer feature is even
the right shape.** This repo has three real shapes — see `.claude/rules/nestjs-feature-pattern.md`:
- A new Postgres-backed domain resource → full layered feature, use `notification`
  (`src/features/notification/*`, `src/packages/entities/notification/*`) as the reference.
- A thin wrapper around one external API with no DB table (like `email`/Resend) → stateless
  service + controller only, no repository, no Zod entities.
- A thin wrapper around one external SDK client (like `uploads`/S3) → service + provider +
  interface, no repository, no Zod entities.

If it's genuinely the first case, continue below.

## Inputs

Ask the user (or infer from the request) before generating:

1. **Feature name** — singular, lowercase (e.g. `webhook-log`). Controller route is the plural.
2. **Fields** — name, type, required/optional, validation (min/max/uuid/enum/url/regex).
3. Whether it needs a **Drizzle table** in `src/database/schema.ts` (usually yes for a new
   domain) — see the important note in `.claude/rules/database.md` about `schema.ts` already
   containing a large set of vestigial (unused) education-domain tables; don't confuse those
   with an active reference.
4. Which **sibling services** it depends on so their modules get imported.

If fields are unclear, propose a sensible set and confirm before writing files.

## Composition — run the layer skills in order

This is the orchestrator. Build a feature by applying the focused per-layer skills in
dependency order (each depends on the one above):

1. **generate-db-table** — add the `pgTable`/`pgEnum` to `schema.ts`, generate migration.
2. **generate-entity** — Zod schema + DTOs under `src/packages/entities/{name}/`.
3. **generate-repository** — Drizzle data access.
4. **generate-service** — business logic + validation.
5. **generate-controller** — routes + Swagger.
6. **generate-module** — module file + wire into `app.module.ts`.

The per-layer skills carry the detailed spec; the summary below is the shape to match.

## Naming conventions

- Files: `{name}.controller.ts`, `{name}.service.ts`, `{name}.repository.ts`, `{name}.module.ts`.
- Service methods aren't required to carry a `...Service` suffix in this repo (unlike
  `tutor-service`/`user`) — `NotificationService` doesn't use it consistently either
  (`createNotificationService` does, `findAll`/`findById`/`delete` don't). Match whichever style
  the rest of the new feature's sibling code already uses; don't invent a strict rule where none
  exists here.
- List responses: `{ data, pagination: { total, page, limit, totalPages } }` — the key is
  `data`, not the resource name (this differs from `tutor-service`/`user`'s convention).
