import { z } from 'zod';
import { createRequestLogSchema, getRequestLogsQuerySchema } from './log.schema';

export type CreateRequestLogDto = z.infer<typeof createRequestLogSchema>;
export type GetRequestLogsQueryDto = z.infer<typeof getRequestLogsQuerySchema>;
