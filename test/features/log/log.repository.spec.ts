import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { LogRepository } from 'src/features/log/log.repository';

/** Chainable + awaitable stand-in for a drizzle select builder; records every call's arguments. */
function fakeSelectDb(rows: unknown[]) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  for (const method of ['from', 'where', 'groupBy', 'orderBy', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls[method] = args;
      return chain;
    };
  }
  const db = { select: jest.fn((fields: unknown) => ((calls.select = [fields]), chain)) };
  return { db, calls };
}

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as SQL);

describe('LogRepository.statsByEndpoint', () => {
  it('maps rows: numeric strings → numbers, p95 rounded, missing method → "—"', async () => {
    const { db } = fakeSelectDb([
      { method: 'GET', path: '/classes', calls24h: 12, errorCount: '3', p95Ms: '412.6' },
      { method: null, path: '/health', calls24h: 1, errorCount: '0', p95Ms: null },
    ]);
    const repo = new LogRepository(db as never);

    await expect(repo.statsByEndpoint()).resolves.toEqual([
      { method: 'GET', path: '/classes', calls24h: 12, errorCount24h: 3, p95Ms: 413 },
      { method: '—', path: '/health', calls24h: 1, errorCount24h: 0, p95Ms: 0 },
    ]);
  });

  it('asks Postgres for a 95th percentile of duration and counts errors as status >= 400', async () => {
    const { db, calls } = fakeSelectDb([]);
    await new LogRepository(db as never).statsByEndpoint();

    const fields = calls.select[0] as Record<string, unknown>;
    expect(render(fields.p95Ms).sql).toBe(
      'percentile_cont(0.95) within group (order by "request_logs"."duration_ms")',
    );
    expect(render(fields.errorCount).sql).toBe(
      'count(*) filter (where "request_logs"."status_code" >= 400)',
    );
  });

  it('only counts gateway HTTP hops from the last 24h and groups by (method, path)', async () => {
    const { db, calls } = fakeSelectDb([]);
    await new LogRepository(db as never).statsByEndpoint();

    const where = render(calls.where[0]);
    expect(where.sql).toContain('"request_logs"."service_name" = $1');
    expect(where.sql).toContain('"request_logs"."type" = $2');
    expect(where.sql).toContain(`>= now() - interval '24 hours'`);
    expect(where.params).toEqual(['gateway', 'HTTP']);

    // path is grouped by its normalized form (ids collapsed to :id), not the raw path
    const fields = calls.select[0] as Record<string, unknown>;
    expect(calls.groupBy).toHaveLength(2);
    expect(render(sql`${calls.groupBy[0]}`).sql).toBe('"request_logs"."method"');
    expect(render(calls.groupBy[1]).sql).not.toBe('"request_logs"."path"');
    expect(render(calls.groupBy[1]).sql).toContain('regexp_replace');
    expect(render(calls.groupBy[1])).toEqual(render(fields.path));
  });

  it('normalizes UUID and numeric path segments to :id and drops the query string', async () => {
    const { db, calls } = fakeSelectDb([]);
    await new LogRepository(db as never).statsByEndpoint();

    const fields = calls.select[0] as Record<string, unknown>;
    const { sql: pathSql, params } = render(fields.path);
    expect(pathSql).toContain('split_part("request_logs"."path"');
    expect(pathSql).toContain('[0-9a-fA-F]{8}-[0-9a-fA-F]{4}');
    expect(pathSql).toContain('/[0-9]+(?=/|$)');
    expect(pathSql).toContain("'/:id'");
    expect(params).toEqual([]);
  });
});

describe('LogRepository.create', () => {
  it('persists the nullable header/host columns and returns the inserted row', async () => {
    const captured: { values?: Record<string, unknown> } = {};
    const row = { id: 'l1' };
    const db = {
      insert: jest.fn(() => ({
        values: (v: Record<string, unknown>) => {
          captured.values = v;
          return { returning: () => Promise.resolve([row]) };
        },
      })),
    };

    const result = await new LogRepository(db as never).create({
      serviceName: 'gateway',
      type: 'HTTP',
      path: '/classes',
      durationMs: 5,
      correlationId: 'c1',
      traceId: 't1',
      requestHeaders: '{"content-type":"application/json"}',
      responseHeaders: '{"server":"nginx"}',
      host: 'api-gateway:8080',
    });

    expect(result).toBe(row);
    expect(captured.values).toMatchObject({
      requestHeaders: '{"content-type":"application/json"}',
      responseHeaders: '{"server":"nginx"}',
      host: 'api-gateway:8080',
    });
  });

  it('leaves them undefined (NULL) when the hop did not capture any', async () => {
    const captured: { values?: Record<string, unknown> } = {};
    const db = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          captured.values = v;
          return { returning: () => Promise.resolve([{}]) };
        },
      }),
    };
    await new LogRepository(db as never).create({
      serviceName: 'user',
      type: 'RPC',
      path: 'user.get',
      durationMs: 1,
      correlationId: 'c',
      traceId: 't',
    });
    expect(captured.values?.requestHeaders).toBeUndefined();
    expect(captured.values?.host).toBeUndefined();
  });
});

describe('LogRepository.findByCorrelationId', () => {
  it('selects full rows (incl. new columns) for the correlation id ordered by createdAt', async () => {
    const rows = [{ id: '1', host: 'gateway:8888', requestHeaders: '{}', responseHeaders: null }];
    const { db, calls } = fakeSelectDb(rows);
    await expect(new LogRepository(db as never).findByCorrelationId('c1')).resolves.toEqual(rows);
    expect(render(calls.where[0]).params).toEqual(['c1']);
    expect(calls.select).toEqual([]);
  });
});

/** Queue-driven drizzle stand-in: each awaited select chain pops the next result from `results`. */
function queuedSelectDb(results: unknown[][]) {
  const calls: Array<Record<string, unknown[]>> = [];
  const db = {
    select: jest.fn(() => {
      const call: Record<string, unknown[]> = {};
      calls.push(call);
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(results.shift() ?? []).then(resolve, reject),
      };
      for (const method of ['from', 'where', 'groupBy', 'orderBy', 'limit', 'offset']) {
        chain[method] = (...args: unknown[]) => {
          call[method] = args;
          return chain;
        };
      }
      return chain;
    }),
  };
  return { db, calls };
}

describe('LogRepository.findAll', () => {
  const baseQuery = { page: 1, limit: 20 } as never;

  it('returns rows with pagination computed from the count query', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const { db } = queuedSelectDb([[{ total: '45' }], rows]);
    const result = await new LogRepository(db as never).findAll(baseQuery);

    expect(result).toEqual({
      data: rows,
      pagination: { total: 45, page: 1, limit: 20, totalPages: 3 },
    });
  });

  it('reports zero pages when nothing matches', async () => {
    const { db } = queuedSelectDb([[{ total: '0' }], []]);
    const result = await new LogRepository(db as never).findAll(baseQuery);
    expect(result.pagination).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    expect(result.data).toEqual([]);
  });

  it('treats a missing count row as zero', async () => {
    const { db } = queuedSelectDb([[], []]);
    const result = await new LogRepository(db as never).findAll(baseQuery);
    expect(result.pagination.total).toBe(0);
  });

  it('converts the page into an offset and applies limit', async () => {
    const { db, calls } = queuedSelectDb([[{ total: '100' }], []]);
    await new LogRepository(db as never).findAll({ page: 3, limit: 10 } as never);

    const listCall = calls[1];
    expect(listCall.limit).toEqual([10]);
    expect(listCall.offset).toEqual([20]);
    expect(listCall.orderBy).toHaveLength(1);
  });

  it('issues no WHERE clause when no filters are given', async () => {
    const { db, calls } = queuedSelectDb([[{ total: '0' }], []]);
    await new LogRepository(db as never).findAll(baseQuery);

    expect(calls[0].where).toEqual([undefined]);
    expect(calls[1].where).toEqual([undefined]);
  });

  it('maps every filter to its column and ANDs them together', async () => {
    const { db, calls } = queuedSelectDb([[{ total: '1' }], []]);
    await new LogRepository(db as never).findAll({
      page: 1,
      limit: 5,
      serviceName: 'gateway',
      type: 'HTTP',
      correlationId: 'c-1',
      search: 'classes',
    } as never);

    const where = render(calls[1].where[0]);
    expect(where.sql).toContain('"request_logs"."service_name" = $1');
    expect(where.sql).toContain('"request_logs"."type" = $2');
    expect(where.sql).toContain('"request_logs"."correlation_id" = $3');
    expect(where.sql).toContain('"request_logs"."path" ilike $4');
    expect(where.sql).toContain(' and ');
    expect(where.params).toEqual(['gateway', 'HTTP', 'c-1', '%classes%']);
    // Count query shares the same WHERE so pagination matches the filtered list.
    expect(render(calls[0].where[0]).params).toEqual(where.params);
  });

  it('applies only the filters that were provided', async () => {
    const { db, calls } = queuedSelectDb([[{ total: '0' }], []]);
    await new LogRepository(db as never).findAll({ page: 1, limit: 5, type: 'RPC' } as never);

    const where = render(calls[1].where[0]);
    expect(where.sql).toBe('"request_logs"."type" = $1');
    expect(where.params).toEqual(['RPC']);
  });

  it('treats an empty-string filter as absent', async () => {
    const { db, calls } = queuedSelectDb([[{ total: '0' }], []]);
    await new LogRepository(db as never).findAll({ page: 1, limit: 5, search: '' } as never);
    expect(calls[1].where).toEqual([undefined]);
  });
});

describe('LogRepository.findByCorrelationId', () => {
  it('filters by correlation id and orders hops by creation time', async () => {
    const { db, calls } = queuedSelectDb([[{ id: 'h1' }, { id: 'h2' }]]);
    const rows = await new LogRepository(db as never).findByCorrelationId('corr-9');

    expect(rows).toEqual([{ id: 'h1' }, { id: 'h2' }]);
    expect(render(calls[0].where[0]).params).toEqual(['corr-9']);
    expect(calls[0].orderBy).toHaveLength(1);
  });
});

describe('LogRepository.statsByEndpoint edge cases', () => {
  it('returns an empty list when there are no gateway HTTP hops in the window', async () => {
    const { db } = fakeSelectDb([]);
    await expect(new LogRepository(db as never).statsByEndpoint()).resolves.toEqual([]);
  });

  it('rounds p95 to the nearest millisecond and keeps .4 down', async () => {
    const { db } = fakeSelectDb([
      { method: 'GET', path: '/a', calls24h: 1, errorCount: '0', p95Ms: '10.4' },
      { method: 'GET', path: '/b', calls24h: 1, errorCount: '0', p95Ms: '10.5' },
    ]);
    const result = await new LogRepository(db as never).statsByEndpoint();
    expect(result.map((r) => r.p95Ms)).toEqual([10, 11]);
  });

  it('orders the endpoint list by call volume', async () => {
    const { db, calls } = fakeSelectDb([]);
    await new LogRepository(db as never).statsByEndpoint();
    expect(calls.orderBy).toHaveLength(1);
    expect(render(calls.orderBy[0]).sql).toBe('count(*) desc');
  });
});
