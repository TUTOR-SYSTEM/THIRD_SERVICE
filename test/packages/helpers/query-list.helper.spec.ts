import { integer, pgTable, text, PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { buildListWhereClause } from '@packages/helpers';

const dialect = new PgDialect();
const render = (clause: SQL | undefined) => (clause ? dialect.sqlToQuery(clause) : undefined);

const items = pgTable('items', {
  title: text('title'),
  body: text('body'),
  status: text('status'),
  tutorId: text('tutor_id'),
  classId: text('class_id'),
  amount: integer('amount'),
});

describe('buildListWhereClause', () => {
  it('returns undefined when there is nothing to filter on', () => {
    expect(buildListWhereClause({})).toBeUndefined();
  });

  it('ignores a blank search string', () => {
    expect(
      buildListWhereClause({
        search: '   ',
        searchableColumns: { title: { column: items.title } },
      }),
    ).toBeUndefined();
  });

  it('builds an ILIKE OR-group across searchable columns', () => {
    const clause = buildListWhereClause({
      search: ' abc ',
      searchableColumns: { title: { column: items.title }, body: { column: items.body } },
    });
    const { sql, params } = render(clause)!;
    expect(sql).toMatch(/ilike/i);
    expect(sql).toMatch(/\bor\b/i);
    expect(params).toEqual(['%abc%', '%abc%']);
  });

  it('adds EQ conditions for filters, skipping null/undefined values', () => {
    const clause = buildListWhereClause({
      filters: { status: 'OPEN', tutorId: undefined, classId: null },
      filterColumns: {
        status: { column: items.status },
        tutorId: { column: items.tutorId },
        classId: { column: items.classId },
      },
    });
    const { sql, params } = render(clause)!;
    expect(sql).toMatch(/"items"\."status"/);
    expect(sql).not.toMatch(/tutor_id|class_id/);
    expect(params).toEqual(['OPEN']);
  });

  it('applies the transform before comparing a filter', () => {
    const clause = buildListWhereClause({
      filters: { amount: '5' },
      filterColumns: {
        amount: { column: items.amount, transform: (v: unknown) => Number(v) },
      },
    });
    expect(render(clause)!.params).toEqual([5]);
  });

  it('ANDs search and filters together', () => {
    const clause = buildListWhereClause({
      search: 'x',
      searchableColumns: { title: { column: items.title } },
      filters: { status: 'OPEN' },
      filterColumns: { status: { column: items.status } },
    });
    expect(render(clause)!.sql).toMatch(/\band\b/i);
  });

  it('ignores filters that have no matching column definition', () => {
    expect(buildListWhereClause({ filters: { unknown: 'x' }, filterColumns: {} })).toBeUndefined();
  });
});
