import { z } from 'zod';
import { createRequestLogSchema, getRequestLogsQuerySchema } from './log.schema';

export type CreateRequestLogDto = z.infer<typeof createRequestLogSchema>;
export type GetRequestLogsQueryDto = z.infer<typeof getRequestLogsQuerySchema>;

/** One row of `GET /logs/stats` — aggregated over the last 24h, grouped by `(method, path)`. */
export type EndpointStatsDto = {
  method: string;
  path: string;
  calls24h: number;
  errorCount24h: number;
  p95Ms: number;
};
