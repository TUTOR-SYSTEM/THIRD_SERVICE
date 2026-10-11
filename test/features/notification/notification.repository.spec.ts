import { NotificationRepository } from 'src/features/notification/notification.repository';

/** Thenable drizzle-style query builder: every step returns itself, awaiting resolves `result`. */
const chain = (result: unknown) => {
  const c: Record<string, unknown> = {};
  for (const step of ['from', 'where', 'orderBy', 'limit', 'offset', 'set', 'values', 'returning']) {
    c[step] = jest.fn(() => c);
  }
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return c as Record<string, jest.Mock> & PromiseLike<unknown>;
};

describe('NotificationRepository', () => {
  const db = { insert: jest.fn(), select: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const repo = new NotificationRepository(db as never);

  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('maps optional fields to undefined (not null) so DB defaults apply', async () => {
      const values = chain([{ id: 'n1' }]);
      db.insert.mockReturnValue({ values: values.values });
      values.values.mockReturnValue(values);

      const result = await repo.create({
        type: 'SYSTEM',
        title: 'hi',
        content: 'body',
        subContent: null,
        userId: null,
        senderId: null,
        classId: null,
        studentId: null,
      } as never);

      expect(result).toEqual({ id: 'n1' });
      expect(values.values).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SYSTEM',
          title: 'hi',
          content: 'body',
          subContent: undefined,
          userId: undefined,
          senderId: undefined,
          classId: undefined,
          studentId: undefined,
          redirectUrl: undefined,
          metadata: undefined,
        }),
      );
    });

    it('keeps provided optional values', async () => {
      const values = chain([{ id: 'n2' }]);
      db.insert.mockReturnValue({ values: values.values });
      values.values.mockReturnValue(values);

      await repo.create({
        type: 'TUITION',
        title: 't',
        content: 'c',
        userId: 'u',
        redirectUrl: '/x',
        metadata: { a: 1 },
      } as never);

      expect(values.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u', redirectUrl: '/x', metadata: { a: 1 } }),
      );
    });
  });

  describe('findAll', () => {
    it('computes offset from page/limit and returns pagination totals', async () => {
      const countChain = chain([{ total: '25' }]);
      const rowsChain = chain([{ id: 'a', createdAt: new Date('2026-01-02T03:04:05Z') }]);
      db.select.mockReturnValueOnce(countChain).mockReturnValueOnce(rowsChain);

      const result = await repo.findAll('user-1', { page: 3, limit: 10 } as never);

      expect(rowsChain.limit).toHaveBeenCalledWith(10);
      expect(rowsChain.offset).toHaveBeenCalledWith(20);
      expect(result.pagination).toEqual({ total: 25, page: 3, limit: 10, totalPages: 3 });
    });

    it('serializes createdAt to ISO strings and keeps string dates as-is', async () => {
      const countChain = chain([{ total: 2 }]);
      const rowsChain = chain([
        { id: 'a', createdAt: new Date('2026-01-02T03:04:05.000Z') },
        { id: 'b', createdAt: '2026-02-02T00:00:00.000Z' },
      ]);
      db.select.mockReturnValueOnce(countChain).mockReturnValueOnce(rowsChain);

      const result = await repo.findAll('u', { page: 1, limit: 10 } as never);

      expect(result.data).toEqual([
        { id: 'a', createdAt: '2026-01-02T03:04:05.000Z' },
        { id: 'b', createdAt: '2026-02-02T00:00:00.000Z' },
      ]);
    });

    it('reports zero total pages when there are no rows', async () => {
      db.select.mockReturnValueOnce(chain([{ total: 0 }])).mockReturnValueOnce(chain([]));

      const result = await repo.findAll('u', { page: 1, limit: 10 } as never);

      expect(result).toEqual({
        data: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });
    });
  });

  describe('findById', () => {
    it('returns the row or null', async () => {
      db.select.mockReturnValueOnce(chain([{ id: 'x' }])).mockReturnValueOnce(chain([]));

      await expect(repo.findById('x')).resolves.toEqual({ id: 'x' });
      await expect(repo.findById('y')).resolves.toBeNull();
    });
  });

  describe('markAsRead / markAllAsRead / delete', () => {
    it('markAsRead returns the updated row or null when none matched', async () => {
      const c = chain([{ id: 'x', isRead: true }]);
      db.update.mockReturnValueOnce({ set: c.set });
      c.set.mockReturnValue(c);
      await expect(repo.markAsRead('x')).resolves.toEqual({ id: 'x', isRead: true });

      const empty = chain([]);
      db.update.mockReturnValueOnce({ set: empty.set });
      empty.set.mockReturnValue(empty);
      await expect(repo.markAsRead('none')).resolves.toBeNull();
    });

    it('markAllAsRead resolves with the raw driver result', async () => {
      const c = chain({ count: 4 });
      db.update.mockReturnValueOnce({ set: c.set });
      c.set.mockReturnValue(c);

      await expect(repo.markAllAsRead('u')).resolves.toEqual({ count: 4 });
    });

    it('delete reports true only when a row came back', async () => {
      db.delete.mockReturnValueOnce(chain([{ id: 'x' }])).mockReturnValueOnce(chain([]));

      await expect(repo.delete('x')).resolves.toBe(true);
      await expect(repo.delete('x')).resolves.toBe(false);
    });
  });
});

describe('NotificationRepository.findAll filter matrix', () => {
  const { PgDialect } = jest.requireActual<typeof import('drizzle-orm/pg-core')>('drizzle-orm/pg-core');
  const dialect = new PgDialect();
  const render = (fragment: unknown) => dialect.sqlToQuery(fragment as never);

  const runFindAll = async (query: Record<string, unknown>) => {
    const countChain = chain([{ total: '0' }]);
    const rowsChain = chain([]);
    const db = { select: jest.fn().mockReturnValueOnce(countChain).mockReturnValueOnce(rowsChain) };
    await new NotificationRepository(db as never).findAll('user-1', { page: 1, limit: 20, ...query } as never);
    return { where: render(countChain.where.mock.calls[0][0]), rowsWhere: render(rowsChain.where.mock.calls[0][0]) };
  };

  it('always scopes to the caller as recipient or sender', async () => {
    const { where } = await runFindAll({});
    expect(where.sql).toBe('("notifications"."user_id" = $1 or "notifications"."sender_id" = $2)');
    expect(where.params).toEqual(['user-1', 'user-1']);
  });

  it('adds a case-insensitive title search only when search is given', async () => {
    const { where } = await runFindAll({ search: 'exam' });
    expect(where.sql).toContain('"notifications"."title" ilike $3');
    expect(where.params).toContain('%exam%');
  });

  it('adds a type filter when type is given', async () => {
    const { where } = await runFindAll({ type: 'SYSTEM' });
    expect(where.sql).toContain('"notifications"."type" = $3');
    expect(where.params).toContain('SYSTEM');
  });

  it('filters isRead=false explicitly (false is a real filter, not "absent")', async () => {
    const { where } = await runFindAll({ isRead: false });
    expect(where.sql).toContain('"notifications"."is_read" = $3');
    expect(where.params).toContain(false);
  });

  it('filters isRead=true explicitly', async () => {
    const { where } = await runFindAll({ isRead: true });
    expect(where.params).toContain(true);
  });

  it('applies the same WHERE to the count and the page query', async () => {
    const { where, rowsWhere } = await runFindAll({ type: 'SYSTEM', isRead: false });
    expect(rowsWhere.sql).toBe(where.sql);
    expect(rowsWhere.params).toEqual(where.params);
  });
});
