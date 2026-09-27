import { z } from 'zod';

export const logTypeSchema = z.enum(['HTTP', 'RPC']);

export const createRequestLogSchema = z.object({
  serviceName: z.string().min(1).max(50),
  type: logTypeSchema,
  method: z.string().max(10).optional(),
  path: z.string().min(1),
  statusCode: z.number().int().optional(),
  durationMs: z.number().int().min(0),
  correlationId: z.string().min(1),
  traceId: z.string().min(1),
  parentTraceId: z.string().optional(),
  userId: z.string().uuid().optional(),
  ip: z.string().max(64).optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  errorMessage: z.string().optional(),
});

export const getRequestLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  serviceName: z.string().optional(),
  type: logTypeSchema.optional(),
  correlationId: z.string().optional(),
  search: z.string().trim().min(1).optional(),
});
