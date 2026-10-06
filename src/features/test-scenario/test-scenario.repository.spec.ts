import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { TestScenarioRepository } from './test-scenario.repository';

/** Chainable + awaitable stand-in for a drizzle select builder. `selectDistinctOn` returns a
 * subquery-able builder (`.as()`), the main `select` resolves to `rows`. */
function fakeDb(rows: unknown[]) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  for (const method of ['from', 'leftJoin', 'where', 'groupBy', 'orderBy']) {
    chain[method] = (...args: unknown[]) => {
      calls[method] = args;
      return chain;
    };
  }
  const subquery = { scenarioId: 'sub.scenario_id', passed: 'sub.passed' };
  const distinctChain = {
    from: () => distinctChain,
    orderBy: () => distinctChain,
    as: () => subquery,
  };
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

describe('TestScenarioRepository.findAll flow', () => {
  /** `select` is called twice: scenarios+latest-run join first, then the single hops query. */
  function dbWith(scenarioRows: unknown[], hopRows: unknown[]) {
    const { db, calls } = fakeDb(scenarioRows);
    const hops: Record<string, unknown> = {
      then: (resolve: (v: unknown[]) => unknown) => resolve(hopRows),
    };
    const hopCalls: Record<string, unknown[]> = {};
    for (const method of ['from', 'where', 'orderBy']) {
      hops[method] = (...args: unknown[]) => {
        hopCalls[method] = args;
        return hops;
      };
    }
    const original = db.select;
    let n = 0;
    db.select = jest.fn((fields: unknown) => (n++ === 0 ? original(fields) : hops)) as never;
    return { db, hopCalls, calls };
  }

  const run = (correlationId: string) => ({
    runId: 's',
    correlationId,
    actualStatus: 200,
    passed: true,
    durationMs: 10,
    runAt: new Date(0),
  });

  it('attaches ordered hops per lastRun correlationId using a single extra query', async () => {
    const { db, hopCalls } = dbWith(
      [
        { scenario: { id: 'a' }, ...run('c1') },
        { scenario: { id: 'b' }, ...run('c2') },
        { scenario: { id: 'never' }, runId: null, correlationId: null },
      ],
      [
        {
          correlationId: 'c1',
          serviceName: 'gateway',
          type: 'HTTP',
          statusCode: 200,
          durationMs: 30,
        },
        { correlationId: 'c1', serviceName: 'user', type: 'RPC', statusCode: null, durationMs: 12 },
        {
          correlationId: 'c2',
          serviceName: 'gateway',
          type: 'HTTP',
          statusCode: 401,
          durationMs: 4,
        },
      ],
    );

    const result = await new TestScenarioRepository(db as never).findAll({});

    expect(db.select).toHaveBeenCalledTimes(2); // not N+1
    const where = new PgDialect().sqlToQuery(hopCalls.where[0] as SQL);
    expect(where.params).toEqual(['c1', 'c2']);
    expect(result[0].flow).toEqual([
      { serviceName: 'gateway', type: 'HTTP', statusCode: 200, durationMs: 30 },
      { serviceName: 'user', type: 'RPC', statusCode: null, durationMs: 12 },
    ]);
    expect(result[1].flow).toEqual([
      { serviceName: 'gateway', type: 'HTTP', statusCode: 401, durationMs: 4 },
    ]);
    expect(result[2].flow).toEqual([]);
    expect(result[2].lastRun).toBeNull();
  });

  it('skips the hops query entirely when no scenario has run', async () => {
    const { db } = dbWith([{ scenario: { id: 'x' }, runId: null, correlationId: null }], []);
    const result = await new TestScenarioRepository(db as never).findAll({});
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(result[0].flow).toEqual([]);
  });
});
