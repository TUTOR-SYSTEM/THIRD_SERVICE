import { PgDialect } from 'drizzle-orm/pg-core';
import { TestScenarioRepository } from 'src/features/test-scenario/test-scenario.repository';

const dialect = new PgDialect();

/** Records every builder call; the main select resolves to `rows`. */
function fakeDb(rows: unknown[]) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  for (const method of ['from', 'leftJoin', 'where', 'orderBy']) {
    chain[method] = (...args: unknown[]) => {
      calls[method] = args;
      return chain;
    };
  }
  const distinctChain = { from: () => distinctChain, orderBy: () => distinctChain, as: () => ({}) };
  const db = {
    select: jest.fn(() => chain),
    selectDistinctOn: jest.fn(() => distinctChain),
  };
  return { db, calls };
}

describe('TestScenarioRepository.findAll — filters', () => {
  it('applies service, method, path and category as one AND condition, upper-casing the method', async () => {
    const { db, calls } = fakeDb([]);
    const repo = new TestScenarioRepository(db as never);

    await repo.findAll({ service: 'user', method: 'post', path: '/users', category: 'valid' } as never);

    const where = calls.where[0] as Parameters<typeof dialect.sqlToQuery>[0];
    const { sql, params } = dialect.sqlToQuery(where);
    expect(sql).toMatch(/"service" = .*and.*"method" = .*and.*"path" = .*and.*"category" = /i);
    expect(params).toEqual(expect.arrayContaining(['user', 'POST', '/users', 'valid']));
  });

  it('uses no WHERE clause when the query has no filters', async () => {
    const { db, calls } = fakeDb([]);
    const repo = new TestScenarioRepository(db as never);

    await repo.findAll({} as never);

    expect(calls.where[0]).toBeUndefined();
  });
});
