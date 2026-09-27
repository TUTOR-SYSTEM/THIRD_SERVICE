import { Injectable, Logger } from '@nestjs/common';
import type { CreateRequestLogDto, GetRequestLogsQueryDto } from '@packages/entities/log';
import { LogRepository } from './log.repository';

@Injectable()
export class LogService {
  private readonly logger = new Logger(LogService.name);
  constructor(private readonly repo: LogRepository) {}

  /** Fire-and-forget — called from `log.create` (RPC) or in-process (this service's own hops). */
  async createInternal(dto: CreateRequestLogDto): Promise<void> {
    try {
      await this.repo.create(dto);
    } catch (err) {
      this.logger.warn(
        `Failed to persist request log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async findAll(query: GetRequestLogsQueryDto) {
    return this.repo.findAll(query);
  }

  async findByCorrelationId(correlationId: string) {
    return this.repo.findByCorrelationId(correlationId);
  }
}
