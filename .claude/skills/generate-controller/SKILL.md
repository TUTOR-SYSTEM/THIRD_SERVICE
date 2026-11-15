---
name: generate-controller
description: Scaffold the controller layer (src/features/{name}/{name}.controller.ts) — CRUD routes with ZodValidationPipe, CurrentUser, and Swagger decorators, plural route path. Use when asked to create/add a controller, routes, or REST endpoints for a Postgres-backed feature in this NestJS infra/utility backend.
---

# Generate Controller

Create `src/features/foo/foo.controller.ts`, mirroring `notification.controller.ts` — the only
full CRUD controller in this repo. (If the feature you're building is actually a thin wrapper
around one external API/SDK with no DB table, this skill doesn't apply — see `email.controller.ts`
or `upload.controller.ts` instead, and `.claude/rules/nestjs-feature-pattern.md`.)

## Prerequisites
- `FooService` exists (see `generate-service`).
- DTOs + schemas exist under `@packages/entities/foo`.

## Shape
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBody, ApiResponse as SwaggerResponse,
  ApiBearerAuth, ApiParam, ApiQuery,
} from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { ZodValidationPipe } from '@packages/pipes';
import { CurrentUser } from '@packages/decorators';
import { createFooSchema, type CreateFooDto, getFoosQuerySchema, type GetFoosQueryDto } from '@packages/entities/foo';
import { type JwtGuardUser } from '@packages/guards/jwt-auth.guard';
import { FooService } from './foo.service';

@ApiTags('Foos')
@ApiBearerAuth('access-token')
@Controller('foos') // plural route
export class FooController {
  constructor(private readonly fooService: FooService) {}
  // POST / , GET / , GET /:id , DELETE /:id (+ any PATCH sub-actions, e.g. notification's read-state routes)
}
```

## Routes (mirror notification.controller.ts)
- `@Post()` `@HttpCode(StatusCodes.CREATED)` → body via
  `new ZodValidationPipe<CreateFooDto>(createFooSchema)` + `@CurrentUser() user: JwtGuardUser`;
  call the service's create method, spreading in whatever actor field it needs (`notification`
  passes `senderId: user.id`, not `userId` — match your domain's actual FK name).
- `@Get('')` `@HttpCode(StatusCodes.OK)` → query via
  `new ZodValidationPipe<GetFoosQueryDto>(getFoosQuerySchema)` + `@CurrentUser() user`.
- `@Get('/:id')` → `@Param('id') id`.
- `@Delete(':id')` → `@Param('id') id`.
- Extra `@Patch(...)` sub-action routes are fine for state transitions (see
  `PATCH /notifications/:id/read` and `PATCH /notifications/read-all`) — declare a specific
  literal sub-path (`read-all`) before a `:id` route so it isn't shadowed.

Get the current user with `@CurrentUser() user: JwtGuardUser` (from `@packages/decorators`) —
do NOT use the old `@User` decorator.

There is no parent/child resource pattern in this repo (no `class`/`schedule`-style ownership
hierarchy) — every route here is guarded globally, not scoped through a parent resource.

## Swagger
This repo inlines Swagger content directly on the controller (`@ApiOperation`,
`@ApiBody({ schema: {...} })`, `@ApiQuery(...)`, `@ApiResponse as SwaggerResponse`) rather than
pulling from `src/data/swaggers/*` data files — match `notification.controller.ts`'s inline
style, don't introduce the separate-file pattern used in `tutor-service`/`user` unless asked to.
Every new `@ApiTags('X')` must also get a matching `.addTag('X')` in the `DocumentBuilder` chain in `src/main.ts` (and removed there if the controller is deleted). Keep the tag list in sync with `conventions.md`.

## Rules
- Controllers hold no business logic — delegate everything to the service.
- Import `ZodValidationPipe` from `@packages/pipes`, DTOs/schemas from `@packages/entities/foo`.
- HTTP controllers in this repo are class-level `@Public()` (no access token, no ADMIN gate) — except
  `notification`, which stays JWT-guarded because it scopes by `user.id`. Match
  `email.controller.ts`/`upload.controller.ts`. Global `LanguageGuard`/`TokenBucketGuard` still apply.
  Never add `@Public()` to `*.rpc.controller.ts`.
