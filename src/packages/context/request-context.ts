import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Constant across the entire distributed flow (gateway → every downstream RabbitMQ hop). */
  correlationId: string;
  /** Unique to this specific hop — a fresh one is generated for every outbound RabbitMQ call. */
  traceId: string;
  /** `traceId` of whichever hop directly triggered this one, if any. */
  parentTraceId?: string;
  /** Which service is currently executing — one constant per repo. */
  serviceName: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const TRACE_ID_HEADER = 'x-trace-id';
export const PARENT_TRACE_ID_HEADER = 'x-parent-trace-id';
export const SERVICE_NAME_HEADER = 'x-service-name';

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `ctx` available to every synchronous and asynchronous call made within it (via
 * `getRequestContext()`) — including anything downstream: interceptors, services,
 * `RmqProducer.send()`. Node's `AsyncLocalStorage` correctly threads this through promise
 * chains and callbacks, so nothing needs to pass `ctx` around explicitly.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
