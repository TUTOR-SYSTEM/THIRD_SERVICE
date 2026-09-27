import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import {
  CORRELATION_ID_HEADER,
  PARENT_TRACE_ID_HEADER,
  runWithRequestContext,
  SERVICE_NAME_HEADER,
} from '@packages/context/request-context';
import { emitRequestLog } from '@packages/context/log-sink';

const SERVICE_NAME = 'third-service';
const MAX_LOG_LENGTH = 1000;
const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'oldPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        SENSITIVE_KEYS.includes(key) ? '[REDACTED]' : redact(val),
      ]),
    );
  }
  return value;
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
    const requestBody = isLogPattern ? undefined : previewPayload(context);

    return new Observable((subscriber) => {
      let responseData: unknown;
      runWithRequestContext(
        { correlationId, traceId, parentTraceId, serviceName: SERVICE_NAME },
        () => {
          next.handle().subscribe({
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
                  responseBody: previewError(err),
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
                  responseBody: previewResponse(responseData),
                });
              }
              subscriber.complete();
            },
          });
        },
      );
    });
  }
}
