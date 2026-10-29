import { BadRequestException, Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import type { CreateRequestLogDto } from '@packages/entities/log';
import { getRequestLogsQuerySchema } from '@packages/entities/log';
import { LogService } from './log.service';

const traceSchema = z.object({
  correlationId: z.string().trim().min(1, 'correlationId is required').max(100),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

/**
 * Reached by every service's `RmqProducer` — `log.create` is fired with `.emit()`
 * (fire-and-forget, no reply expected) from the gateway's HTTP `LoggerInterceptor` and each
 * service's RPC `TraceContextInterceptor`. `log.query`/`log.trace` are reached with `.send()`
 * from the gateway's thin `logs` proxy controller so an admin can inspect requests across
 * all microservices from this one table.
 */
@Controller()
export class LogRpcController {
  constructor(private readonly logService: LogService) {}

  @EventPattern('log.create')
  create(@Payload() dto: CreateRequestLogDto) {
    return this.logService.createInternal(dto);
  }

  @MessagePattern('log.query')
  query(@Payload() payload: unknown) {
    const result = getRequestLogsQuerySchema.safeParse(payload ?? {});
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((i) => i.message).join('; '));
    }
    return this.logService.findAll(result.data);
  }

  @MessagePattern('log.trace')
  trace(@Payload() payload: unknown) {
    const result = traceSchema.safeParse(payload ?? {});
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((i) => i.message).join('; '));
    }
    return this.logService.findByCorrelationId(result.data.correlationId, result.data.limit);
  }

  @MessagePattern('log.stats')
  stats() {
    return this.logService.stats();
  }
}
