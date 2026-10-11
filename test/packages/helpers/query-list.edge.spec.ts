import { integer, pgTable, text, PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { buildListWhereClause } from '@packages/helpers';

const dialect = new PgDialect();
const render = (clause: SQL | undefined) => (clause ? dialect.sqlToQuery(clause) : undefined);

const items = pgTable('items', {
  title: text('title'),
  status: text('status'),
  amount: integer('amount'),
});

describe('buildListWhereClause — edge cases', () => {
  it('skips a searchable entry that is null and keeps the rest', () => {
    const clause = render(
      buildListWhereClause({
        search: 'hi',
        searchableColumns: { missing: null as never, title: { column: items.title } },
      }),
    );
    expect(clause?.sql).toContain('ilike');
    expect(clause?.params).toEqual(['%hi%']);
  });

  it('returns undefined when every searchable entry is null', () => {
    expect(
      buildListWhereClause({ search: 'hi', searchableColumns: { missing: null as never } }),
    ).toBeUndefined();
  });

  it('ignores null and undefined filter values and filters with no column mapping', () => {
    expect(
      buildListWhereClause({
        filters: { status: undefined, amount: null, unmapped: 'x' } as never,
        filterColumns: { status: { column: items.status } } as never,
      }),
    ).toBeUndefined();
  });

  it('applies a filter transform before comparing', () => {
    const clause = render(
      buildListWhereClause({
        filters: { amount: '5' } as never,
        filterColumns: { amount: { column: items.amount, transform: (v: string) => Number(v) } } as never,
      }),
    );
    expect(clause?.params).toEqual([5]);
  });
});

describe('buildListWhereClause — remaining branches', () => {
  it('ignores search when there are no searchable columns at all', () => {
    expect(buildListWhereClause({ search: 'hi' })).toBeUndefined();
  });

  it('uses the raw filter value when the column has no transform', () => {
    const clause = render(
      buildListWhereClause({
        filters: { status: 'open' } as never,
        filterColumns: { status: { column: items.status } } as never,
      }),
    );
    expect(clause?.params).toEqual(['open']);
  });
});
