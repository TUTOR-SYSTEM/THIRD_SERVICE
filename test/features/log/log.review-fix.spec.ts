import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { LogRepository } from 'src/features/log/log.repository';
import { LogRpcController } from 'src/features/log/log.rpc.controller';

const dialect = new PgDialect();
const render = (f: unknown) => dialect.sqlToQuery(f as SQL);

function fakeDb(rows: unknown[] = []) {
  const calls: Record<string, unknown[][]> = {};
  const chain: Record<string, unknown> = { then: (r: (v: unknown[]) => unknown) => r(rows) };
  for (const m of ['from', 'where', 'orderBy', 'limit', 'offset']) {
    chain[m] = (...a: unknown[]) => ((calls[m] ??= []).push(a), chain);
  }
  return { db: { select: jest.fn(() => chain) }, calls };
}

describe('F-33 log search escaping', () => {
  it('escapes \\, % and _', async () => {
    const { db, calls } = fakeDb([{ total: 0 }]);
    await new LogRepository(db as never).findAll({ page: 1, limit: 20, search: '/a_b%c\\' } as any);
    expect(render(calls.where[0][0]).params).toContain('%/a\\_b\\%c\\\\%');
  });
});

describe('F-38 findByCorrelationId is bounded', () => {
  it('applies a default limit', async () => {
    const { db, calls } = fakeDb([]);
    await new LogRepository(db as never).findByCorrelationId('c-1');
    expect(calls.limit?.[0][0]).toBe(500);
  });
});

describe('F-34/F-21 log.query payload parsing', () => {
  it('empty query -> defaults page 1 limit 20 (no NaN offset)', async () => {
    const service = { findAll: jest.fn().mockResolvedValue({}) };
    const rpc = new LogRpcController(service as never);
    await rpc.query({} as any);
    expect(service.findAll.mock.calls[0][0]).toMatchObject({ page: 1, limit: 20 });
  });
  it('undefined payload also defaults', async () => {
    const service = { findAll: jest.fn().mockResolvedValue({}) };
    await new LogRpcController(service as never).query(undefined as any);
    expect(service.findAll.mock.calls[0][0]).toMatchObject({ page: 1, limit: 20 });
  });
});
