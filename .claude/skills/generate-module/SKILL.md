---
name: generate-module
description: Scaffold the NestJS module (src/features/{name}/{name}.module.ts) and wire it into src/app.module.ts imports. Use when asked to create/add a module or register a feature in this NestJS infra/utility backend.
---

# Generate Module + Wire

Create `src/features/foo/foo.module.ts` and register it in `app.module.ts`.

## Prerequisites
Controller and service exist for the feature (repository too, if it's a Postgres-backed
feature — see `.claude/rules/nestjs-feature-pattern.md` for which shape applies).

## `foo.module.ts` (mirror notification.module.ts)
```ts
import { Module } from '@nestjs/common';
import { FooController } from './foo.controller';
import { FooRepository } from './foo.repository'; // omit if this feature has no repository
import { FooService } from './foo.service';

@Module({
  imports: [],
  controllers: [FooController],
  providers: [FooService, FooRepository], // drop FooRepository if none
  exports: [FooService],
})
export class FooModule {}
```
`notification.module.ts` has an empty `imports: []` — this repo's features don't inject each
other's services (unlike `tutor-service`'s cross-feature FK validation pattern). Only add an
`imports` entry if your new feature genuinely needs another feature's exported service.

## Wiring `src/app.module.ts` (required)
1. Add `import { FooModule } from './features/foo/foo.module';` with the other feature imports.
2. Add `FooModule` into the `imports: [...]` array.

## After
Run `bun run build` (or `bunx tsc --noEmit`) to confirm the module resolves and DI compiles.

## Not for infra modules
This scaffold is for domain feature modules. A module wrapping an external connection (`redis`)
is `@Global()`, has no repository/controller, and exports its service(s) directly —
see the "Infra modules" section in `.claude/rules/nestjs-feature-pattern.md`. Same for `uploads`
(has a `.provider.ts` instead of a repository) — its module still follows the shape above minus
`FooRepository`, plus the provider in `providers: [...]`.
