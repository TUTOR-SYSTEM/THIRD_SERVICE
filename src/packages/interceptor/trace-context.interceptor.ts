import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { Observable, type Subscription } from 'rxjs';
import { randomUUID } from 'node:crypto';
import {
  CORRELATION_ID_HEADER,
  PARENT_TRACE_ID_HEADER,
  runWithRequestContext,
  SERVICE_NAME_HEADER,
} from '@packages/context/request-context';
import { emitRequestLog } from '@packages/context/log-sink';

const SERVICE_NAME = 'third-service';

/** Service address for the `host` column: `SERVICE_HOST`, else `${SERVICE_NAME}:${PORT}`. */
export function resolveServiceHost(): string {
  const configured = process.env.SERVICE_HOST?.trim();
  if (configured) return configured.slice(0, 100);
  return `${SERVICE_NAME}:${process.env.PORT?.trim() || '8888'}`.slice(0, 100);
}

const MAX_LOG_LENGTH = 1000;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 6;
const SENSITIVE_KEYS = new Set(
  [
    'password',
    'newPassword',
    'oldPassword',
    'confirmPassword',
    'token',
    'accessToken',
    'refreshToken',
    'resetToken',
    'verifyToken',
    // reset-password JWT id: the reset token itself is valid for 5 minutes (TRD3-11).
    'jti',
    'value',
    'secret',
    'code',
    'authorization',
    'cookie',
  ].map((k) => k.toLowerCase()),
);
/** Patterns whose payloads/responses may carry secrets or bulk data — never previewed. */
const OMITTED_PATTERN_PREFIXES = ['redis.', 'health.', 'email.', 'upload.'];
const JWT_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

function isOmittedPattern(pattern: string): boolean {
  return OMITTED_PATTERN_PREFIXES.some((prefix) => pattern.startsWith(prefix));
}

function binarySize(value: unknown): number | undefined {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.length;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.length;
  if (value !== null && typeof value === 'object') {
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return data.length;
  }
  return undefined;
}

/**
 * Bounded, redacted copy of `value`: sensitive keys and JWT-shaped strings are masked, `buffer`
 * fields become a size marker, and long strings/arrays/objects are cut BEFORE serialisation so a
 * big payload (file upload, large list) is never fully stringified.
 */
function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.slice(0, MAX_STRING_LENGTH).replace(JWT_PATTERN, '[REDACTED]');
  }
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return `[binary ${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`…(${value.length - MAX_ARRAY_ITEMS} more)`);
    return items;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, val] of entries.slice(0, MAX_OBJECT_KEYS)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
      continue;
    }
    const size = key === 'buffer' ? binarySize(val) : undefined;
    out[key] = size !== undefined ? `[binary ${size} bytes]` : redact(val, depth + 1);
  }
  if (entries.length > MAX_OBJECT_KEYS) out['…'] = `${entries.length - MAX_OBJECT_KEYS} more keys`;
  return out;
}

/** Best-effort, redacted+truncated preview of the RPC payload — never throws. */
function previewPayload(context: ExecutionContext): string | undefined {
  try {
    const data: unknown = context.switchToRpc().getData();
    if (data === undefined) return undefined;
    const json = JSON.stringify(redact(data));
    return json.length > MAX_LOG_LENGTH ? `${json.slice(0, MAX_LOG_LENGTH)}…(truncated)` : json;
  } catch {
    return undefined;
  }
}

/** Best-effort, redacted+truncated preview of response data — never throws. */
function previewResponse(data: unknown): string | undefined {
  try {
    if (data === undefined) return undefined;
    const json = JSON.stringify(redact(data));
    return json.length > MAX_LOG_LENGTH ? `${json.slice(0, MAX_LOG_LENGTH)}…(truncated)` : json;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort, redacted+truncated preview of the FULL error payload — never throws. Mirrors what
 * `RpcExceptionFilter` sends back to the caller (statusCode/message/errors), so `responseBody` is
 * populated on failure the same way it is on success instead of being left `NULL`.
 */
function previewError(err: unknown): string | undefined {
  try {
    let payload: unknown;
    if (
      err &&
      typeof err === 'object' &&
      typeof (err as { getResponse?: unknown }).getResponse === 'function'
    ) {
      const response = (err as { getResponse: () => unknown }).getResponse();
      const status =
        typeof (err as { getStatus?: unknown }).getStatus === 'function'
          ? (err as { getStatus: () => number }).getStatus()
          : undefined;
      payload =
        response !== null && typeof response === 'object'
          ? { statusCode: status, ...(response as Record<string, unknown>) }
          : { statusCode: status, message: response };
    } else if (err instanceof Error) {
      payload = { name: err.name, message: err.message };
    } else {
      payload = err;
    }
    const json = JSON.stringify(redact(payload));
    return json.length > MAX_LOG_LENGTH ? `${json.slice(0, MAX_LOG_LENGTH)}…(truncated)` : json;
  } catch {
    return undefined;
  }
}

function readHeader(headers: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = headers?.[key];
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : undefined;
}

/** Extracts `{pattern, headers}` from the RMQ context — AMQP headers live on `properties.headers`. */
function readRpcMetadata(context: ExecutionContext): {
  pattern: string;
  headers: Record<string, unknown> | undefined;
} {
  const rmqContext = context.switchToRpc().getContext<RmqContext>();
  const message = rmqContext.getMessage() as
    { properties?: { headers?: Record<string, unknown> } } | undefined;
  return { pattern: rmqContext.getPattern(), headers: message?.properties?.headers };
}

/**
 * Registered as a *microservice-scoped* global interceptor in `main.ts`
 * (`rmqMicroservice.useGlobalInterceptors(...)`)
 * — every `@MessagePattern`/`@EventPattern` handler runs inside the
 * `RequestContext` this opens. Reads the caller's `correlationId` (kept unchanged for the whole
 * distributed flow) and `traceId` (becomes this hop's `parentTraceId`) off the message headers
 * `RmqProducer.send()`/`.emit()` attach on the sending side (see `[[rmq-rpc-plumbing]]`
 * memory), mints a fresh `traceId` for this hop, and logs entry/exit the same way
 * `LoggerInterceptor` does for HTTP requests on the gateway.
 */
@Injectable()
export class TraceContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TraceContextInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const { pattern, headers } = readRpcMetadata(context);

    const correlationId = readHeader(headers, CORRELATION_ID_HEADER) ?? randomUUID();
    const parentTraceId = readHeader(headers, PARENT_TRACE_ID_HEADER);
    const callerService = readHeader(headers, SERVICE_NAME_HEADER);
    const traceId = randomUUID();

    const startTime = Date.now();
    const trace = `correlationId=${correlationId} traceId=${traceId} from=${callerService ?? 'unknown'}`;
    this.logger.log(`[RPC] ${pattern} <- ${trace}`);
    // Don't log the logging plumbing itself as a request row.
    const isLogPattern = pattern.startsWith('log.');
    const omitBodies = isLogPattern || isOmittedPattern(pattern);
    const requestBody = omitBodies ? undefined : previewPayload(context);

    return new Observable((subscriber) => {
      let responseData: unknown;
      let inner: Subscription | undefined;
      runWithRequestContext(
        { correlationId, traceId, parentTraceId, serviceName: SERVICE_NAME },
        () => {
          inner = next.handle().subscribe({
            next: (value) => {
              responseData = value;
              subscriber.next(value);
            },
            error: (err: unknown) => {
              this.logger.error(`[RPC ERROR] ${pattern} ${trace} - ${(err as Error)?.message}`);
              if (!isLogPattern) {
                emitRequestLog({
                  serviceName: SERVICE_NAME,
                  type: 'RPC',
                  path: pattern,
                  durationMs: Date.now() - startTime,
                  correlationId,
                  traceId,
                  parentTraceId,
                  requestBody,
                  host: resolveServiceHost(),
                  responseBody: omitBodies ? undefined : previewError(err),
                  errorMessage: (err as Error)?.message ?? String(err),
                });
              }
              subscriber.error(err);
            },
            complete: () => {
              this.logger.log(`[RPC] ${pattern} -> ${trace} - ${Date.now() - startTime}ms`);
              if (!isLogPattern) {
                emitRequestLog({
                  serviceName: SERVICE_NAME,
                  type: 'RPC',
                  path: pattern,
                  durationMs: Date.now() - startTime,
                  correlationId,
                  traceId,
                  parentTraceId,
                  requestBody,
                  host: resolveServiceHost(),
                  responseBody: omitBodies ? undefined : previewResponse(responseData),
                });
              }
              subscriber.complete();
            },
          });
        },
      );
      return () => inner?.unsubscribe();
    });
  }
}
