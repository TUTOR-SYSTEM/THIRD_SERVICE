import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { TestScenarioRepository } from 'src/features/test-scenario/test-scenario.repository';

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

/** Builder stand-in for CRUD methods: records calls and resolves to `rows` at the end. */
function crudDb(rows: unknown[]) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  for (const method of ['from', 'where', 'orderBy', 'limit', 'values', 'returning', 'set']) {
    chain[method] = (...args: unknown[]) => {
      calls[method] = args;
      return chain;
    };
  }
  const db = {
    select: jest.fn((fields: unknown) => ((calls.select = [fields]), chain)),
    insert: jest.fn((table: unknown) => ((calls.insert = [table]), chain)),
    update: jest.fn((table: unknown) => ((calls.update = [table]), chain)),
    delete: jest.fn((table: unknown) => ((calls.delete = [table]), chain)),
  };
  return { db, calls };
}

describe('TestScenarioRepository CRUD', () => {
  it('create inserts the dto and returns the stored row', async () => {
    const dto = { method: 'GET', path: '/x', expectedStatus: 200 };
    const { db, calls } = crudDb([{ id: 's', ...dto }]);
    await expect(new TestScenarioRepository(db as never).create(dto as never)).resolves.toEqual({ id: 's', ...dto });
    expect(calls.values).toEqual([dto]);
  });

  it('createMany short-circuits on an empty batch without touching the database', async () => {
    const { db } = crudDb([]);
    await expect(new TestScenarioRepository(db as never).createMany([])).resolves.toEqual([]);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('createMany inserts the whole batch in one statement', async () => {
    const batch = [{ path: '/a' }, { path: '/b' }];
    const { db, calls } = crudDb(batch);
    await expect(new TestScenarioRepository(db as never).createMany(batch as never)).resolves.toEqual(batch);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(calls.values).toEqual([batch]);
  });

  it('existingKeys builds a set of "METHOD path name" keys', async () => {
    const { db } = crudDb([
      { method: 'GET', path: '/classes', name: 'list' },
      { method: 'GET', path: '/classes', name: 'list' },
      { method: 'POST', path: '/classes', name: 'create' },
    ]);
    const keys = await new TestScenarioRepository(db as never).existingKeys();
    expect(keys.size).toBe(2);
    expect([...keys]).toEqual(
      expect.arrayContaining([expect.stringContaining('GET'), expect.stringContaining('POST')]),
    );
  });

  it('existingKeys is empty when no scenario exists', async () => {
    const { db } = crudDb([]);
    await expect(new TestScenarioRepository(db as never).existingKeys()).resolves.toEqual(new Set());
  });

  it('findById returns the first row or null', async () => {
    const found = crudDb([{ id: 's1' }]);
    await expect(new TestScenarioRepository(found.db as never).findById('s1')).resolves.toEqual({ id: 's1' });

    const missing = crudDb([]);
    await expect(new TestScenarioRepository(missing.db as never).findById('nope')).resolves.toBeNull();
  });

  it('update sets the patch on the matching row and returns it, or null when absent', async () => {
    const hit = crudDb([{ id: 's1', name: 'new' }]);
    await expect(new TestScenarioRepository(hit.db as never).update('s1', { name: 'new' } as never)).resolves.toEqual({
      id: 's1',
      name: 'new',
    });
    expect(hit.calls.set).toEqual([{ name: 'new' }]);

    const miss = crudDb([]);
    await expect(new TestScenarioRepository(miss.db as never).update('x', {} as never)).resolves.toBeNull();
  });

  it('delete returns the removed row or null', async () => {
    const hit = crudDb([{ id: 's1' }]);
    await expect(new TestScenarioRepository(hit.db as never).delete('s1')).resolves.toEqual({ id: 's1' });

    const miss = crudDb([]);
    await expect(new TestScenarioRepository(miss.db as never).delete('x')).resolves.toBeNull();
  });

  it('findRuns returns the newest runs for one scenario, limited', async () => {
    const { db, calls } = crudDb([{ id: 'r2' }, { id: 'r1' }]);
    await expect(new TestScenarioRepository(db as never).findRuns('s1', 5)).resolves.toEqual([
      { id: 'r2' },
      { id: 'r1' },
    ]);
    expect(calls.limit).toEqual([5]);
    expect(calls.orderBy).toHaveLength(1);
  });

  it('createRun inserts a run row and returns it', async () => {
    const data = { scenarioId: 's1', correlationId: 'c', passed: true };
    const { db, calls } = crudDb([{ id: 'r', ...data }]);
    await expect(new TestScenarioRepository(db as never).createRun(data as never)).resolves.toEqual({
      id: 'r',
      ...data,
    });
    expect(calls.values).toEqual([data]);
  });
});
