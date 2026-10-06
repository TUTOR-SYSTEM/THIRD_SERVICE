import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, ilike, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { requestLogs } from '../../database/schema';
import type {
  CreateRequestLogDto,
  EndpointStatsDto,
  GetRequestLogsQueryDto,
} from '@packages/entities/log';

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
        requestHeaders: data.requestHeaders,
        responseHeaders: data.responseHeaders,
        host: data.host,
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

    const [[totalRow], rows] = await Promise.all([
      this.db.select({ total: count() }).from(requestLogs).where(where),
      this.db
        .select()
        .from(requestLogs)
        .where(where)
        .orderBy(desc(requestLogs.createdAt))
        .limit(limit)
        .offset(offset),
    ]);
    const total = Number(totalRow?.total ?? 0);

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

  /** One row per `(method, path)` seen at the gateway HTTP edge in the last 24h — the "calls/24h"
   * and "P95" columns on the admin endpoint-stats table. Root HTTP hops only (same rule as the
   * request list): RPC hops between services never count here. */
  async statsByEndpoint(): Promise<EndpointStatsDto[]> {
    const rows = await this.db
      .select({
        method: requestLogs.method,
        path: requestLogs.path,
        calls24h: count(),
        errorCount: sql<string>`count(*) filter (where ${requestLogs.statusCode} >= 400)`,
        p95Ms: sql<string>`percentile_cont(0.95) within group (order by ${requestLogs.durationMs})`,
      })
      .from(requestLogs)
      .where(
        and(
          eq(requestLogs.serviceName, 'gateway'),
          eq(requestLogs.type, 'HTTP'),
          gte(requestLogs.createdAt, sql`now() - interval '24 hours'`),
        ),
      )
      .groupBy(requestLogs.method, requestLogs.path)
      .orderBy(desc(count()));

    return rows.map((r) => ({
      method: r.method ?? '—',
      path: r.path,
      calls24h: Number(r.calls24h),
      errorCount24h: Number(r.errorCount),
      p95Ms: Math.round(Number(r.p95Ms ?? 0)),
    }));
  }
}
