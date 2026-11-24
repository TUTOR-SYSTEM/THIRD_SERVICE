import { z } from 'zod';

/** Cap on free-text columns so one publisher cannot bloat `request_logs`. */
const LOG_TEXT_MAX = 10_000;
/** Truncates instead of rejecting: an oversized preview must not make `log.create` drop the whole row. */
const clipped = (max: number) =>
  z.string().transform((s) => (s.length > max ? s.slice(0, max) : s));

export const logTypeSchema = z.enum(['HTTP', 'RPC']);

export const createRequestLogSchema = z.object({
  serviceName: z.string().min(1).max(50),
  type: logTypeSchema,
  method: z.string().max(10).optional(),
  path: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 2000)),
  statusCode: z.number().int().optional(),
  durationMs: z.number().int().min(0),
  correlationId: z.string().min(1).max(100),
  traceId: z.string().min(1).max(100),
  parentTraceId: z.string().max(100).optional(),
  userId: z.string().uuid().optional(),
  ip: z.string().max(64).optional(),
  requestBody: clipped(LOG_TEXT_MAX).optional(),
  responseBody: clipped(LOG_TEXT_MAX).optional(),
  requestHeaders: clipped(LOG_TEXT_MAX).optional(),
  responseHeaders: clipped(LOG_TEXT_MAX).optional(),
  host: z.string().max(100).optional(),
  errorMessage: clipped(LOG_TEXT_MAX).optional(),
});

export const getRequestLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  serviceName: z.string().optional(),
  type: logTypeSchema.optional(),
  correlationId: z.string().max(100).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});
