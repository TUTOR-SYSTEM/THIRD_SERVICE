import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { TestFixtureRepository } from 'src/features/test-scenario/test-fixture.repository';

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as SQL);

/**
 * Chainable drizzle stand-in. Every terminal call (`then`) resolves to `rows`, and each builder
 * method call is recorded so the test can check the WHERE / ORDER BY / SET that was produced.
 */
function fakeDb(rows: unknown[]) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  for (const method of ['from', 'where', 'orderBy', 'values', 'returning', 'set']) {
    chain[method] = (...args: unknown[]) => {
      calls[method] = args;
      return chain;
    };
  }
  return {
    calls,
    db: {
      select: jest.fn((fields: unknown) => ((calls.select = [fields]), chain)),
      insert: jest.fn((table: unknown) => ((calls.insert = [table]), chain)),
      update: jest.fn((table: unknown) => ((calls.update = [table]), chain)),
      delete: jest.fn((table: unknown) => ((calls.delete = [table]), chain)),
    },
  };
}

describe('TestFixtureRepository', () => {
  it('findAll returns every fixture ordered by key ascending', async () => {
    const rows = [{ key: 'a' }, { key: 'b' }];
    const { db, calls } = fakeDb(rows);
    const result = await new TestFixtureRepository(db as never).findAll();

    expect(result).toEqual(rows);
    expect(calls.orderBy).toHaveLength(1);
    expect(render(calls.orderBy[0]).sql).toBe('"test_fixtures"."key" asc');
  });

  it('findById returns the first matching row', async () => {
    const { db, calls } = fakeDb([{ id: 'f1' }, { id: 'f2' }]);
    await expect(new TestFixtureRepository(db as never).findById('f1')).resolves.toEqual({ id: 'f1' });
    expect(render(calls.where[0]).params).toEqual(['f1']);
  });

  it('findById returns null when no row matches', async () => {
    const { db } = fakeDb([]);
    await expect(new TestFixtureRepository(db as never).findById('missing')).resolves.toBeNull();
  });

  it('findByKey looks up by the key column, not the id', async () => {
    const { db, calls } = fakeDb([{ key: 'classId' }]);
    await expect(new TestFixtureRepository(db as never).findByKey('classId')).resolves.toEqual({
      key: 'classId',
    });
    const where = render(calls.where[0]);
    expect(where.sql).toBe('"test_fixtures"."key" = $1');
    expect(where.params).toEqual(['classId']);
  });

  it('findByKey returns null when the key is unknown', async () => {
    const { db } = fakeDb([]);
    await expect(new TestFixtureRepository(db as never).findByKey('nope')).resolves.toBeNull();
  });

  it('create inserts the dto and returns the stored row', async () => {
    const dto = { key: 'classId', value: 'abc' };
    const { db, calls } = fakeDb([{ id: 'new', ...dto }]);
    await expect(new TestFixtureRepository(db as never).create(dto as never)).resolves.toEqual({
      id: 'new',
      ...dto,
    });
    expect(calls.values).toEqual([dto]);
    expect(calls.returning).toEqual([]);
  });

  it('update sets the given fields on the row with that id and returns it', async () => {
    const patch = { value: '42', resolvedAt: new Date('2030-01-01T00:00:00Z') };
    const { db, calls } = fakeDb([{ id: 'f1', ...patch }]);
    await expect(
      new TestFixtureRepository(db as never).update('f1', patch as never),
    ).resolves.toEqual({ id: 'f1', ...patch });

    expect(calls.set).toEqual([patch]);
    const where = render(calls.where[0]);
    expect(where.params).toEqual(['f1']);
  });

  it('update returns null when nothing was updated', async () => {
    const { db } = fakeDb([]);
    await expect(
      new TestFixtureRepository(db as never).update('ghost', { value: 'x' } as never),
    ).resolves.toBeNull();
  });

  it('delete removes the row with that id and returns it', async () => {
    const { db, calls } = fakeDb([{ id: 'f1' }]);
    await expect(new TestFixtureRepository(db as never).delete('f1')).resolves.toEqual({ id: 'f1' });
    expect(calls.delete).toEqual([expect.anything()]);
    expect(render(calls.where[0]).params).toEqual(['f1']);
  });

  it('delete returns null when the id does not exist', async () => {
    const { db } = fakeDb([]);
    await expect(new TestFixtureRepository(db as never).delete('ghost')).resolves.toBeNull();
  });
});
