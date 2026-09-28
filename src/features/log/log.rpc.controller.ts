import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import type { CreateRequestLogDto, GetRequestLogsQueryDto } from '@packages/entities/log';
import { LogService } from './log.service';

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
  query(@Payload() query: GetRequestLogsQueryDto) {
    return this.logService.findAll(query);
  }

  @MessagePattern('log.trace')
  trace(@Payload() payload: { correlationId: string }) {
    return this.logService.findByCorrelationId(payload.correlationId);
  }

  @MessagePattern('log.stats')
  stats() {
    return this.logService.stats();
  }
}
