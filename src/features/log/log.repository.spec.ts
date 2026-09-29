import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { LogRepository } from './log.repository';

/** Chainable + awaitable stand-in for a drizzle select builder; records every call's arguments. */
function fakeSelectDb(rows: unknown[]) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  for (const method of ['from', 'where', 'groupBy', 'orderBy']) {
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

    expect(calls.groupBy.map((col) => render(sql`${col}`).sql)).toEqual([
      '"request_logs"."method"',
      '"request_logs"."path"',
    ]);
  });
});
