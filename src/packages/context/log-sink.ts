/**
 * Lets `TraceContextInterceptor`/`LoggerInterceptor` ship a request-log row without needing DI —
 * both are instantiated with `new` in `main.ts`, before the Nest DI container exists, so they
 * can't constructor-inject `LogService`/`RmqProducer` directly. `main.ts` calls `setLogSink(...)`
 * once, right after building the app, wiring this hop's log write; every interceptor call after
 * that just fires into whatever sink was registered. Mirrors the `request-context.ts` pattern of
 * a plain module-level utility reachable from manually-instantiated interceptors.
 */
export interface RequestLogEntry {
  serviceName: string;
  type: 'HTTP' | 'RPC';
  method?: string;
  path: string;
  statusCode?: number;
  durationMs: number;
  correlationId: string;
  traceId: string;
  parentTraceId?: string;
  userId?: string;
  ip?: string;
  requestBody?: string;
  responseBody?: string;
  errorMessage?: string;
}

type LogSinkFn = (entry: RequestLogEntry) => unknown;

let sink: LogSinkFn | undefined;

export function setLogSink(fn: LogSinkFn): void {
  sink = fn;
}

/** Fire-and-forget — never lets a logging failure affect the request it's logging. */
export function emitRequestLog(entry: RequestLogEntry): void {
  if (!sink) return;
  try {
    Promise.resolve(sink(entry)).catch(() => {});
  } catch {
    // swallow — logging must never break the request path
  }
}
