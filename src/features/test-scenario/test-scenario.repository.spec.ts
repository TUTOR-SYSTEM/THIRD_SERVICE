import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { TestScenarioRepository } from './test-scenario.repository';

/** Chainable + awaitable stand-in for a drizzle select builder. `selectDistinctOn` returns a
 * subquery-able builder (`.as()`), the main `select` resolves to `rows`. */
function fakeDb(rows: unknown[]) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = { then: (resolve: (v: unknown[]) => unknown) => resolve(rows) };
  for (const method of ['from', 'leftJoin', 'where', 'groupBy', 'orderBy']) {
    chain[method] = (...args: unknown[]) => {
      calls[method] = args;
      return chain;
    };
  }
  const subquery = { scenarioId: 'sub.scenario_id', passed: 'sub.passed' };
  const distinctChain = { from: () => distinctChain, orderBy: () => distinctChain, as: () => subquery };
  const db = {
    select: jest.fn((fields: unknown) => ((calls.select = [fields]), chain)),
    selectDistinctOn: jest.fn(() => distinctChain),
  };
  return { db, calls };
}

describe('TestScenarioRepository.statsByEndpoint', () => {
  it('converts aggregate strings to numbers', async () => {
    const { db } = fakeDb([
      { method: 'POST', path: '/auth/login', casesTotal: '6', casesPassed: '4' },
      { method: 'GET', path: '/classes', casesTotal: '5', casesPassed: '0' },
    ]);
    const repo = new TestScenarioRepository(db as never);

    await expect(repo.statsByEndpoint()).resolves.toEqual([
      { method: 'POST', path: '/auth/login', casesTotal: 6, casesPassed: 4 },
      { method: 'GET', path: '/classes', casesTotal: 5, casesPassed: 0 },
    ]);
  });

  it('takes the latest run per scenario (DISTINCT ON) and counts never-run scenarios in the total only', async () => {
    const { db, calls } = fakeDb([]);
    await new TestScenarioRepository(db as never).statsByEndpoint();

    expect(db.selectDistinctOn).toHaveBeenCalledTimes(1);
    // total counts every scenario row; passed only counts rows whose latest run passed
    const fields = calls.select[0] as Record<string, unknown>;
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(fields.casesTotal as SQL).sql).toBe('count(*)');
    expect(dialect.sqlToQuery(fields.casesPassed as SQL).sql).toContain('filter (where');
    // LEFT join keeps scenarios that have no run yet
    expect(calls.leftJoin).toBeDefined();
  });
});
