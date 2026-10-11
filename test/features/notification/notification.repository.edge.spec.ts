import { NotificationRepository } from 'src/features/notification/notification.repository';

/** Thenable drizzle-style query builder: every step returns itself, awaiting resolves `result`. */
const chain = (result: unknown) => {
  const c: Record<string, unknown> = {};
  for (const step of ['from', 'where', 'orderBy', 'limit', 'offset']) {
    c[step] = jest.fn(() => c);
  }
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return c as Record<string, jest.Mock> & PromiseLike<unknown>;
};

describe('NotificationRepository.findAll — createdAt serialization', () => {
  it('stringifies a createdAt that is not a Date', async () => {
    const db = { select: jest.fn() };
    db.select
      .mockReturnValueOnce(chain([{ total: 1 }]))
      .mockReturnValueOnce(chain([{ id: 'n1', createdAt: '2026-01-01T00:00:00.000Z' }]));
    const repo = new NotificationRepository(db as never);

    const result = await repo.findAll('user-1', { page: 1, limit: 10 } as never);

    expect(result.data[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('NotificationRepository.findAll — empty count', () => {
  it('reports a total of 0 when the count query returns no row', async () => {
    const db = { select: jest.fn() };
    db.select.mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([]));
    const repo = new NotificationRepository(db as never);

    const result = await repo.findAll('user-1', { page: 1, limit: 10 } as never);

    expect(result.pagination.total).toBe(0);
  });
});
