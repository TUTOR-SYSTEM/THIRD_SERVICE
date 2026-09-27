import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { requestLogs } from '../../database/schema';
import type { CreateRequestLogDto, GetRequestLogsQueryDto } from '@packages/entities/log';

@Injectable()
export class LogRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async create(data: CreateRequestLogDto) {
    const [log] = await this.db
      .insert(requestLogs)
      .values({
        serviceName: data.serviceName,
        type: data.type,
        method: data.method,
        path: data.path,
        statusCode: data.statusCode,
        durationMs: data.durationMs,
        correlationId: data.correlationId,
        traceId: data.traceId,
        parentTraceId: data.parentTraceId,
        userId: data.userId,
        ip: data.ip,
        requestBody: data.requestBody,
        responseBody: data.responseBody,
        errorMessage: data.errorMessage,
      })
      .returning();
    return log;
  }

  async findAll(query: GetRequestLogsQueryDto) {
    const { page, limit, serviceName, type, correlationId, search } = query;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (serviceName) conditions.push(eq(requestLogs.serviceName, serviceName));
    if (type) conditions.push(eq(requestLogs.type, type));
    if (correlationId) conditions.push(eq(requestLogs.correlationId, correlationId));
    if (search) conditions.push(ilike(requestLogs.path, `%${search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.db.select({ total: count() }).from(requestLogs).where(where);
    const total = Number(totalRow?.total ?? 0);

    const rows = await this.db
      .select()
      .from(requestLogs)
      .where(where)
      .orderBy(desc(requestLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByCorrelationId(correlationId: string) {
    return this.db
      .select()
      .from(requestLogs)
      .where(eq(requestLogs.correlationId, correlationId))
      .orderBy(requestLogs.createdAt);
  }
}
