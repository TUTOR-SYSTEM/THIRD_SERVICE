# AGENTS.md

## Quick start

```bash
bun run compose:up      # Start Postgres (5433) + Redis (6380)
cp .env.example .env    # Edit secrets before running
bun run db:migrate      # Apply pending migrations
bun run start:dev       # Dev server on :8888 with --watch
```

**First-time setup** (or after dropping DB):

```bash
bun scripts/recreate-db.ts   # Drop → push schema → seed 3 accounts
```

- **Runtime**: Bun (`bun run <script>`). Install deps with `npm install` (lockfile is npm's).
- **No branch/PR conventions** — just commit directly.
- **No CI pipeline** exists yet.

## Commands (non-obvious)

| Command | Note |
|---|---|
| `bun run lint` / `bun run lint:check` | Flat ESLint config (`eslint.config.mjs`) with `projectService: true` (type-checked). Slow on first run. |
| `bun run format` / `bun run format:check` | Prettier only. **ESLint has `prettier/prettier: off`** — run format separately from lint. |
| `bun run test` | **Bun test** (all `*.spec.ts` in `src/` and `test/`). |
| `bun run test:unit` | Bun test limited to `test/` dir. |
| `bun run test:e2e` | Jest with `test/jest-e2e.json` config (only if Node is available — Bun cannot run Jest 29). |
| `bun run test:cov` | Bun test with `--coverage` (`c8`-backed). |
| `bun run db:push` | Push schema directly (dev only — skips migration review). |
| `bun run db:seed:user` / `bun run db:seed:users-bulk` | Bun scripts, not Drizzle. |

## Architecture

- **Single NestJS app** (not a monorepo). Entry: `src/main.ts`.
- **Global JWT guard** via `APP_GUARD` in `app.module.ts`. Use `@Public()` to bypass.
- **Response shape** enforced by `ResponseInterceptor`: `{ statusCode, message, data, timestamp, method, path }`.
- **Validation**: Zod v4 schemas in `src/packages/entities/{domain}/{domain}.schema.ts`, DTO types in `*.dto.ts`. Used via `ZodValidationPipe`.
- **Database**: Drizzle ORM (`postgres.js` driver). Single schema file `src/database/schema.ts`. Drizzle injection token is the string `'DRIZZLE'`.
- **Repository pattern is optional**: `category`, `wallet`, `transaction` have repositories; `auth`, `user` do not.

## Imports

```ts
// Path alias (configured in tsconfig.json, Jest, and ESLint):
import { Public } from '@packages/decorators';

// Relative imports within features (no alias):
import { DRIZZLE } from '../../database/database.module';
```

Only `@packages/*` is aliased. Do not create new aliases.

## Ports (non-standard vs defaults)

| Service | Host port |
|---|---|
| PostgreSQL | `5433` (default `5432`) |
| Redis | `6380` (default `6379`) |
| API server | `8888` |

## Testing quirks

- **Two test runners coexist**: Jest (`bun run test:e2e`) and Bun test (everything else). Write new unit tests as `*.spec.ts` (Bun test). E2E tests are `*.e2e-spec.ts` (Jest + Supertest).
- Unit tests live in `test/` (co-located with source stubs also in `src/`). E2E tests in `test/`.
- No DB fixtures or test containers exist — E2E tests currently only test the health endpoint.
- **Jest 29 cannot run under Bun** (readonly `Error.prepareStackTrace`). Only the `test:e2e` script still uses Jest — requires Node.js.

## ESLint & TypeScript quirks

- `strictNullChecks: true` only (not full `strict`). `noImplicitAny: false`.
- ESLint uses `recommendedTypeChecked` — slow, needs all referenced .ts files. Ignores `drizzle/`, `dist/`, `coverage/`.
- Rules `@typescript-eslint/no-explicit-any: off`, `prettier/prettier: off`.
- Certain files (redis, mailer, jwt strategy) have relaxed `no-unsafe-*` rules.

## Env & secrets

- `.env` is gitignored. Copy from `.env.example` and set `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (UUID v4).
- `DATABASE_URL` is used if set; otherwise built from `POSTGRES_*` vars.
- JWT falls back: `JWT_ACCESS_SECRET` → `JWT_SECRET` → hardcoded dev secret.
- Email is optional in dev: forgot-password returns 200; the 6-digit reset code is emailed by third-service (SMTP must be configured).

## Docker

- Uses `docker compose` (v2) — also works with `podman compose`.
- Persistent volume `postgres_data` for DB.
- Healthcheck on Postgres container (used by no other service, but available).

## Drizzle migrations

```bash
bun run db:generate   # After editing src/database/schema.ts
bun run db:migrate    # Apply to DB
```

Migrations land in `drizzle/`. Drizzle config in `drizzle.config.ts` duplicates the URL resolution logic from `DatabaseModule`.

## Skills (`.opencode/skills/`)

| Skill | When to use |
|---|---|---|
| `drizzle-orm` | Drizzle queries, schema changes, migrations, seeding |
| `jwt-auth` | Auth flows, JWT tokens, guards, forgot/reset password |
| `wallet-transaction` | Wallet & transaction CRUD, balance math, DTO/schema |
| `presence` | Real-time Socket.io presence module (online/offline tracking via Redis) |
| `module-consistency` | Ensure controller, service, repository, module stay in sync |
| `feature-patterns` | Write new feature or modify existing — full layer-by-layer conventions |

**Note**: `drizzle-kit push` requires `--force` in non-interactive shells (CI, scripts) to skip the TTY confirmation prompt.
