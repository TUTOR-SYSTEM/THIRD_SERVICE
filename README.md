# Backends API

Financial management backend API built with **NestJS 11**, **Drizzle ORM** (PostgreSQL), **Redis**, and **JWT authentication**.

## Quick Start

```bash
# 1. Start infrastructure (Postgres on :5433, Redis on :6380)
bun run compose:up

# 2. Copy env and edit secrets
cp .env.example .env
# Required: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (UUID v4)

# 3. Install dependencies
npm install

# 4. Apply database migrations
bun run db:migrate

# 5. Start dev server (--watch, port :8888)
bun run start:dev
```

## Project Structure

```
src/
├── main.ts                          # Entry point, Swagger setup
├── app.module.ts                    # Root module (global guard, all feature imports)
├── app.controller.ts                # Health check
├── app.service.ts
├── database/
│   ├── database.module.ts           # @Global Drizzle provider
│   └── schema.ts                    # Drizzle schema (all tables, enums)
├── features/                        # Feature modules
│   ├── auth/                        # Register, login, OAuth, password reset
│   ├── user/                        # User CRUD, detail, admin operations
│   ├── category/                    # Transaction categories
│   ├── wallet/                      # Wallets with balance
│   ├── transaction/                 # Transactions (atomic balance updates)
│   ├── report/                      # Aggregated reports
│   ├── redis/                       # Redis key-value access
│   └── email/                       # Mailer module (Nodemailer)
├── packages/                        # Shared utilities
│   ├── entities/                    # Zod schemas + DTO types per domain
│   │   ├── auth/
│   │   ├── user/
│   │   ├── category/
│   │   ├── wallet/
│   │   ├── transactions/
│   │   └── report/
│   ├── decorators/                  # @Public(), @CurrentUser(), @ApiResponse()
│   ├── guards/                      # JwtAuthGuard, AdminRoleGuard
│   ├── interceptors/                # Response/Error/Logger interceptors
│   ├── filters/                     # HttpExceptionFilter
│   ├── pipes/                       # ZodValidationPipe
│   ├── strategy/                    # JWT + Google OAuth strategies
│   ├── helpers/                     # Hashing, JWT signing, query helpers
│   └── interfaces/                  # TypeScript interfaces
└── data/
    └── constants/                   # Error/success messages
```

## Available Commands

| Command | Description |
|---|---|
| `npm run start:dev` | Dev server on :8888 with watch |
| `npm run build` | Production build |
| `npm run start:prod` | Run production build |
| `npm run lint` | ESLint with --fix |
| `npm run lint:check` | ESLint check only |
| `npm run format` | Prettier format |
| `npm run format:check` | Prettier check |
| `npm test` | Jest unit tests |
| `npm run test:cov` | Jest with coverage |
| `npm run test:e2e` | Jest e2e tests |
| `bun run db:generate` | Generate Drizzle migration |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:push` | Push schema directly (dev) |
| `bun run compose:up` | Docker Compose up (Postgres + Redis) |
| `bun run compose:down` | Docker Compose down |

> **Note**: Tests use **Jest** (`bun run test`) for unit tests and **Jest** for e2e. Bun test is not used.

## API Documentation (Swagger)

Once the server is running, visit:

- **Swagger UI**: [http://localhost:8888/api-docs](http://localhost:8888/api-docs)
- **OpenAPI JSON**: [http://localhost:8888/api-docs-json](http://localhost:8888/api-docs-json)

### Authentication

All endpoints require a **Bearer JWT token** in the `Authorization` header unless marked with `@Public()`.

```http
Authorization: Bearer <access_token>
```

**Public endpoints** (no auth required):
- `POST /auth/login`
- `POST /auth/login/user-code`
- `POST /auth/refresh`
- `POST /auth/forgot-password`
- `GET /auth/google`
- `GET /auth/google/callback`

### Standard Response Format

**Success** (`ResponseInterceptor`):
```json
{
  "statusCode": 200,
  "message": "Success",
  "data": { ... },
  "timestamp": "2026-06-25T00:00:00.000Z",
  "method": "GET",
  "path": "/wallets"
}
```

**Error** (`HttpExceptionFilter`):
```json
{
  "success": false,
  "statusCode": 422,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Invalid email", "code": "invalid_string" }],
  "path": "/auth/login",
  "trace": "...",
  "timestamp": "2026-06-25T00:00:00.000Z"
}
```

## API Endpoints

### Auth (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | Bearer | Register new user |
| POST | `/auth/login` | Public | Login with email/password |
| POST | `/auth/login/user-code` | Public | Login with user code |
| POST | `/auth/refresh` | Public | Refresh tokens |
| POST | `/auth/forgot-password` | Public | Request password reset |
| POST | `/auth/reset-password` | Bearer | Reset password |
| GET | `/auth/google` | Public | Google OAuth redirect |
| GET | `/auth/google/callback` | Public | Google OAuth callback |

### Users (`/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users` | Bearer | List users (paginated) |
| GET | `/users/detail-user` | Bearer | Get current user detail |
| GET | `/users/get-by-field` | Bearer | Lookup user by field/value |
| POST | `/users` | Bearer | Create user (admin) |
| PUT | `/users` | Bearer | Update current user |
| PUT | `/users/:id` | Admin | Update any user |
| PUT | `/users/:id/status` | Admin | Toggle user status |
| DELETE | `/users/:id` | Admin | Delete user |

### Categories (`/categories`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/categories` | Bearer | List categories |
| GET | `/categories/:id` | Bearer | Get category by ID |
| POST | `/categories` | Bearer | Create category |
| PUT | `/categories/:id` | Bearer | Update category |
| DELETE | `/categories/:id` | Bearer | Delete category |

### Wallets (`/wallets`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/wallets` | Bearer | List wallets |
| POST | `/wallets` | Bearer | Create wallet |
| PUT | `/wallets/:id` | Bearer | Update wallet |
| DELETE | `/wallets/:id` | Bearer | Delete wallet |

### Transactions (`/transactions`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/transactions` | Bearer | List transactions (filterable) |
| GET | `/transactions/:id` | Bearer | Get transaction |
| POST | `/transactions` | Bearer | Create transaction |
| PUT | `/transactions/:id` | Bearer | Update transaction |
| DELETE | `/transactions/:id` | Bearer | Delete transaction |

> Transactions update wallet balance atomically (PostgreSQL transaction).

### Reports (`/reports`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/reports/summary` | Bearer | Income/expense/net summary |
| GET | `/reports/by-category` | Bearer | Aggregated by category |
| GET | `/reports/trend` | Bearer | Time-series (day/week/month) |
| GET | `/reports/by-wallet` | Bearer | Aggregated by wallet |

### Redis (`/redis`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/redis/get?key=...` | Bearer | Get value by key |

## Database Schema

### Tables

- **`users`** — id, userCode, email, username, firstName, lastName, password, avatar, phone, isActive, role (USER|ADMIN|MODERATOR|TUTOR|PARENT|STUDENT), createdAt, updatedAt
- **`categories`** — id, name, type (INCOME|EXPENSE), parentId, icon, color, createdAt, updatedAt
- **`wallets`** — id, userId, name, type (CASH|BANK|E_WALLET|CREDIT), currency, categoriesId[], balance, note, isDefault, isActive, createdAt, updatedAt
- **`transactions`** — id, name, userId, walletId, categoryId, amount, note, type (INCOME|EXPENSE), status (PENDING|COMPLETED|CANCELLED), createdAt, updatedAt

### Key Relationships
- `wallets.userId` → `users.id` (CASCADE delete)
- `transactions.userId` → `users.id` (CASCADE delete)
- `transactions.walletId` → `wallets.id` (CASCADE delete)
- `transactions.categoryId` → `categories.id` (CASCADE delete)
- `categories.parentId` → `categories.id` (SET NULL on delete)
- `wallets.categoriesId` — soft reference (uuid[] array, no FK constraint)

## Key Architecture Decisions

- **Validation**: Zod v4 schemas in `src/packages/entities/{domain}/` with `ZodValidationPipe`
- **ORM**: Drizzle ORM with `postgres.js` driver (injection token `'DRIZZLE'`)
- **Auth**: Global `JwtAuthGuard` with `@Public()` bypass; separate access/refresh tokens
- **Balance**: Atomic wallet balance updates via `db.transaction()` (BEGIN/COMMIT)
- **Response**: Global interceptor enforces `{ statusCode, message, data, timestamp, method, path }`
- **Config**: Environment-based via `@nestjs/config`, validated at startup

## Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Description |
|---|---|
| `PORT` | API server port (default: 8888) |
| `DATABASE_URL` | PostgreSQL connection string |
| `POSTGRES_*` | Alternative DB config (used if DATABASE_URL not set) |
| `JWT_ACCESS_SECRET` | JWT signing secret for access tokens (UUID) |
| `JWT_REFRESH_SECRET` | JWT signing secret for refresh tokens (UUID) |
| `JWT_ACCESS_EXPIRES_SECONDS` | Access token TTL (default: 10800 = 3h) |
| `JWT_REFRESH_EXPIRES_SECONDS` | Refresh token TTL (default: 604800 = 7d) |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection |
| `MAIL_*` | SMTP config for email (optional in dev) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `GOOGLE_OAUTH_REDIRECT_URL` | Frontend redirect after OAuth |
| `PASSWORD_RESET_URL_BASE` | Frontend reset password URL |

## Infrastructure

```bash
# Start services
bun run compose:up          # Docker Compose
bun run podman:up           # Podman Compose

# Stop services
bun run compose:down

# View logs
podman compose logs -f postgres
```

| Service | Host Port | Image |
|---------|-----------|-------|
| PostgreSQL | 5433 | postgres:16-alpine |
| Redis | 6380 | redis:7-alpine |

## Migrations

```bash
# After editing src/database/schema.ts:
bun run db:generate    # generates migration file
bun run db:migrate     # applies to database
bun run db:push        # pushes schema directly (dev only)
```

## Seed Scripts

```bash
bun run db:seed:user          # Create a single test user
bun run db:seed:users-bulk    # Bulk create users
bun run db:seed:categories    # Seed default categories
bun run db:seed:wallet        # Seed test wallets
```
