---
name: generate-service
description: Scaffold the service layer (src/features/{name}/{name}.service.ts) — business logic with Logger, UUID validation, existence checks, NotFound/BadRequest handling, delegating to the repository. Use when asked to create/add a service or business-logic layer for a Postgres-backed feature in this NestJS infra/utility backend.
---

# Generate Service

Create `src/features/foo/foo.service.ts`, mirroring `notification.service.ts` — the only
repository-backed service in this repo. (For a thin external-API wrapper with no DB table, see
`email.service.ts`/`upload.service.ts` instead — plain methods taking TS object params, no
repository, no `checkUuidValid` FK dance.)

## Prerequisites
- `FooRepository` exists (see `generate-repository`).
- DTOs exist under `@packages/entities/foo`.

## Shape
```ts
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import type { CreateFooDto, GetFoosQueryDto } from '@packages/entities/foo';
import { FooRepository } from './foo.repository';
import { checkUuidValid } from '@packages/helpers';

@Injectable()
export class FooService {
  private readonly logger = new Logger(FooService.name);
  constructor(private readonly repo: FooRepository) {}
  // create, findAll, findById, delete, + any state-transition methods
}
```

## Methods (mirror notification.service.ts)
- **Create**: validate any FK-shaped ids present in the DTO with `checkUuidValid({ data: id })`
  and throw `BadRequestException(ERROR_MESSAGES.X_NOT_VALID)` on a miss — there is **no
  ownership check** pattern here (no `row.tutorId !== userId`); this repo's resources aren't
  owned by a single actor the way `tutor-service`'s are. Then `this.repo.create(dto)`.
- **findAll(userId, query)**: pass straight through to `this.repo.findAll(userId, query)` — the
  repository builds the where-clause, not the service.
- **findById(id)**: `this.repo.findById(id)`, throw `NotFoundException(ERROR_MESSAGES.X_NOT_FOUND)`
  if null.
- **delete(id)** / state transitions (`markAsRead`): ONE round-trip — call `this.repo.delete(id)`
  / `this.repo.markAsRead(id)` directly (they return `false`/`null` when no row matched) and throw
  `NotFoundException` on that, instead of `findById` first. Delete returns `{ id }`.
- Optional: an **internal fire-and-forget variant** (see `createInternal`) for a future
  same-process caller that shouldn't hit the validation/exception path — swallow and log errors
  instead of throwing. Only add this if something will actually call it; don't add it
  speculatively.

## Rules
- Validate every UUID-shaped field with `checkUuidValid({ data: id })` before hitting the DB.
- `BadRequestException` for bad input, `NotFoundException` when a row is missing. There's no
  `ConflictException` pattern here yet (no unique-code generation in this repo) — add one only
  if your feature actually has a uniqueness constraint to enforce.
- Keep all Drizzle access in the repository — the service never imports `drizzle-orm` directly.
