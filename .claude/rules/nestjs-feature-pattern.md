# Rule: NestJS feature pattern (third-service)

There is **no single canonical reference feature** here — unlike `tutor-service`/`user`, this
repo has no `class`-style domain-CRUD feature. It has three genuinely different shapes; pick
whichever matches what you're building. (If you're about to scaffold a `class`/`schedule`-style
child-of-parent feature, stop — that pattern belongs in `tutor-service`, not here.)

## Shape 1 — full layered feature (`notification` is the only example)

`{name}.controller.ts` → `{name}.service.ts` → `{name}.repository.ts`, plus `{name}.module.ts`.
Use this when the feature owns a Postgres table.

- Controller: `@ApiTags`/`@ApiBearerAuth`, routes guarded by the global `JwtAuthGuard` (no
  `@Public()` on `notification`'s routes). Validates body/query with
  `new ZodValidationPipe<Dto>(schema)`, reads `@CurrentUser() user: JwtGuardUser`.
- Service: validates FK-shaped ids with `checkUuidValid` (see `createNotificationService`
  checking `senderId`/`classId`/`studentId`) and throws `BadRequestException`/`NotFoundException`
  — there is **no ownership check** (`row.tutorId !== userId`) pattern here, because
  notifications aren't owned by a single actor the way a `class` row is owned by a tutor. Also
  exposes an internal fire-and-forget method (`createInternal`) meant to be called from other
  in-process code without the validation/exception path — currently unused (nothing in this repo
  calls it yet; it's there for a future same-process caller, not a cross-repo one — a cross-repo
  caller would go through the RPC contract in `../.claude/rules/architecture.md` instead).
- Repository: plain `and()`/`eq()`/`ilike()`/`or()` conditions built inline (NOT
  `buildListWhereClause` — that helper isn't used in this repo). List method returns
  `{ data, pagination: { total, page, limit, totalPages } }` — note the key is `data`, not the
  resource name (`notifications`); this differs from `tutor-service`/`user`'s convention of
  naming the list key after the resource. Match this repo's own existing shape (`data`) for any
  new list endpoint here rather than importing the other convention.
- Module: `providers: [FooService, FooRepository]`, `exports: [FooService]`.

## Shape 2 — stateless service, no repository (`email`)

`{name}.controller.ts` → `{name}.service.ts` + `{name}.module.ts`. No repository, no Zod
entities under `src/packages/entities/` — the service wraps an external API (Resend) directly
and its methods take plain TS object params, not Zod-validated DTOs. `EmailController` currently
exposes only a `@Public()` test route; real send methods (`sendForgotPasswordMail`) are called
from service code, not routed through HTTP.

## Shape 3 — provider/interface, no repository, no entities (`uploads`)

`{name}.controller.ts` → `{name}.service.ts`, plus a `{name}.provider.ts` (an injectable
`Provider` token like `S3_CLIENT` built with a `useFactory`) and a `{name}.interface.ts` (plain
TS interfaces, not Zod). Use this shape for a feature that's a thin wrapper around one external
SDK client (S3-compatible storage, a payment SDK, etc.) with no request-body validation beyond
what `@nestjs/platform-express`'s `FileInterceptor`/Multer already does.

## Infra module (`redis`)

Same as every other service: `@Global()` module, no repository, exported so any feature can
inject it directly.

- `redis` — one `RedisService` owning the `ioredis` connection lifecycle
  (`OnModuleDestroy`), plus `RedisController` (HTTP, `GET /redis?key=`) and
  `RedisRpcController` (`@MessagePattern('redis.get'|'redis.set')` +
  `@EventPattern('redis.del')`) — both call the same unmodified `RedisService`.

There is no message-queue module here: this service only *responds*, via the RMQ microservice
`main.ts` opens on `third_queue`. See `[[rmq-rpc-plumbing]]` memory.

## Hosting an RPC responder (the real, working example)

See `RedisRpcController` (`src/features/redis/redis.rpc.controller.ts`): plain
`@MessagePattern(...)`/`@EventPattern(...)` handlers delegating to `RedisService`.
`RpcExceptionFilter` and `TraceContextInterceptor` are applied globally to the RMQ microservice
in `main.ts` (not per-controller). No registry to update — a new handler is live as soon as it
exists, reachable once the caller's `RmqProducer` routes its prefix to `third_queue`.
- Anything a caller invokes with `.send()` must be a `@MessagePattern` that returns a
  non-undefined value (a void/`@EventPattern` handler gives an empty reply and the caller's
  `send()` fails). Use `@EventPattern` only for `.emit()` targets.
- `redis.get`/`redis.set`/`redis.del` are **generic KV patterns** other services already reuse
  (e.g. `user`'s reset-password tokens and login sessions — see `[[rmq-rpc-plumbing]]`) — don't
  assume a payload arriving on them is about this repo's own domain.

If a feature here ever needs to **call out** to another service, copy gateway's
`src/features/rabbitmq/` module (`RmqModule`/`RmqProducer`) as `user` did.

## General

- **Error messages**: `ERROR_MESSAGES` constants from `src/data/constants/error.constant.ts`
  (see `NotificationService` using `ERROR_MESSAGES.NOTIFICATION_NOT_FOUND` etc.) — never
  hardcode strings in exceptions.
- **Register** every new module in `src/app.module.ts` `imports: [...]`.
- **Route names are plural** where the feature is resource-shaped (`@Controller('notifications')`);
  `upload`/`emails` don't follow a resource-plural convention since they aren't CRUD resources.
