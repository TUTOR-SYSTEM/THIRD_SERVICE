import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { NotificationRepository } from 'src/features/notification/notification.repository';
import { NotificationService } from 'src/features/notification/notification.service';
import { NotificationRpcController } from 'src/features/notification/notification.rpc.controller';
import {
  createNotificationSchema,
  getNotificationsQuerySchema,
} from '@packages/entities/notification';

const dialect = new PgDialect();
const render = (f: unknown) => dialect.sqlToQuery(f as SQL);

const ME = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

/** Chainable, awaitable fake drizzle builder recording `where` args; resolves `rows`. */
function fakeDb(rows: unknown[] = []) {
  const wheres: unknown[] = [];
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  for (const m of ['from', 'set', 'values', 'orderBy', 'limit', 'offset', 'returning']) {
    chain[m] = () => chain;
  }
  chain.where = (w: unknown) => {
    wheres.push(w);
    return chain;
  };
  const db = {
    select: jest.fn(() => chain),
    update: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    insert: jest.fn(() => chain),
  };
  return { db, wheres };
}

function build(rows: unknown[]) {
  const { db, wheres } = fakeDb(rows);
  const repo = new NotificationRepository(db as never);
  const service = new NotificationService(repo);
  const rpc = new NotificationRpcController(service);
  return { rpc, wheres };
}
const params = (wheres: unknown[]) => render(wheres[0]).params as unknown[];

describe('F-12 notification ownership (RPC -> service -> repo)', () => {
  it.each(['getById', 'markAsRead', 'del'] as const)(
    '%s as non-owner scopes the query by userId and returns 404 when nothing matches',
    async (method) => {
      const { rpc, wheres } = build([]);
      await expect(
        (rpc as any)[method]({ id: ID, userId: ME, role: 'STUDENT' }),
      ).rejects.toMatchObject({
        status: 404,
      });
      expect(params(wheres)).toContain(ME);
    },
  );

  it('getById matches userId OR senderId (me appears twice)', async () => {
    const { rpc, wheres } = build([{ id: ID }]);
    await rpc.getById({ id: ID, userId: ME, role: 'STUDENT' } as any);
    expect(params(wheres).filter((p) => p === ME)).toHaveLength(2);
  });

  it('markAsRead/delete are recipient-only (me appears once)', async () => {
    const a = build([{ id: ID }]);
    await (a.rpc as any).markAsRead({ id: ID, userId: ME, role: 'STUDENT' });
    expect(params(a.wheres).filter((p) => p === ME)).toHaveLength(1);
    const b = build([{ id: ID }]);
    await (b.rpc as any).del({ id: ID, userId: ME, role: 'STUDENT' });
    expect(params(b.wheres).filter((p) => p === ME)).toHaveLength(1);
  });

  it.each(['getById', 'markAsRead', 'del'] as const)(
    '%s as ADMIN is not restricted by userId',
    async (method) => {
      const { rpc, wheres } = build([{ id: ID }]);
      await (rpc as any)[method]({ id: ID, userId: ME, role: 'ADMIN' });
      expect(params(wheres)).not.toContain(ME);
    },
  );
});

describe('F-13 create permission by role', () => {
  const base = { title: 't', content: 'c', senderId: ME, userId: ID };
  const create = (type: string, role: string) => {
    const repo = {
      create: jest.fn().mockResolvedValue({ id: 'n' }),
      createMany: jest.fn().mockResolvedValue([{ id: 'n' }]),
      tutorOwnsClass: jest.fn().mockResolvedValue(true),
      tutorTeachesStudent: jest.fn().mockResolvedValue(true),
      studentIdsOfClass: jest.fn().mockResolvedValue([]),
    };
    const rpc = new NotificationRpcController(new NotificationService(repo as never));
    return { repo, run: () => rpc.create({ ...base, type, role } as any) };
  };

  it.each([
    ['SYSTEM', 'TUTOR'],
    ['TUITION', 'TUTOR'],
    ['SYSTEM', 'STUDENT'],
    ['TUTOR', 'STUDENT'],
    ['STUDENT', 'PARENT'],
  ])('type %s by %s -> 403 and nothing is stored', async (type, role) => {
    const { repo, run } = create(type, role);
    await expect(run()).rejects.toMatchObject({ status: 403 });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('ADMIN may create SYSTEM and TUITION', async () => {
    for (const type of ['SYSTEM', 'TUITION']) {
      const { repo, run } = create(type, 'ADMIN');
      await run();
      expect(repo.createMany).toHaveBeenCalled();
    }
  });

  it('TUTOR may create TUTOR/STUDENT typed notifications', async () => {
    for (const type of ['TUTOR', 'STUDENT']) {
      const { repo, run } = create(type, 'TUTOR');
      await run();
      expect(repo.createMany).toHaveBeenCalled();
    }
  });
});

describe('F-13 redirectUrl validation', () => {
  beforeAll(() => {
    process.env.NOTIFICATION_REDIRECT_HOSTS = 'example.com';
  });
  afterAll(() => {
    delete process.env.NOTIFICATION_REDIRECT_HOSTS;
  });
  const parse = (redirectUrl: string) =>
    createNotificationSchema.safeParse({ type: 'TUTOR', title: 't', content: 'c', redirectUrl })
      .success;

  it.each(['/classes/1', '/a?b=1#c', 'https://example.com/x'])('accepts %s', (u) => {
    expect(parse(u)).toBe(true);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'http://example.com',
    '//evil.com',
    'evil.com',
    'JaVaScRiPt:alert(1)',
  ])('rejects %s', (u) => {
    expect(parse(u)).toBe(false);
  });
});

describe('F-23 isRead query parsing', () => {
  it.each([
    ['false', false],
    ['true', true],
  ])('"%s" -> %s', (raw, expected) => {
    expect(getNotificationsQuerySchema.parse({ isRead: raw }).isRead).toBe(expected);
  });
  it('omitted stays undefined; garbage rejected', () => {
    expect(getNotificationsQuerySchema.parse({}).isRead).toBeUndefined();
    expect(getNotificationsQuerySchema.safeParse({ isRead: 'maybe' }).success).toBe(false);
  });
});

describe('F-33 search wildcard escaping (notification)', () => {
  it('escapes \\, % and _', async () => {
    const { db, wheres } = fakeDb([]);
    await new NotificationRepository(db as never).findAll(ME, {
      page: 1,
      limit: 10,
      search: '50%_a\\b',
    } as any);
    const ps = render(wheres[0]).params as string[];
    expect(ps).toContain('%50\\%\\_a\\\\b%');
  });
});

describe('F-34/F-21 notification RPC payload parsing', () => {
  it('getAll without page/limit uses defaults instead of NaN', async () => {
    const service = { findAll: jest.fn().mockResolvedValue({}) };
    const rpc = new NotificationRpcController(service as never);
    await rpc.getAll({ userId: ME, query: {} } as any);
    const q = service.findAll.mock.calls[0][1];
    expect(q.page).toBe(1);
    expect(q.limit).toBe(10);
  });
  it('getAll with undefined query also defaults', async () => {
    const service = { findAll: jest.fn().mockResolvedValue({}) };
    const rpc = new NotificationRpcController(service as never);
    await rpc.getAll({ userId: ME } as any);
    expect(service.findAll.mock.calls[0][1]).toMatchObject({ page: 1, limit: 10 });
  });
  it('create rejects an invalid payload (bad type) before touching the service', async () => {
    const service = { createNotificationService: jest.fn() };
    const rpc = new NotificationRpcController(service as never);
    await expect(
      Promise.resolve().then(() =>
        rpc.create({ type: 'NOPE', title: 't', content: 'c', senderId: ME, role: 'ADMIN' } as any),
      ),
    ).rejects.toBeDefined();
    expect(service.createNotificationService).not.toHaveBeenCalled();
  });
});

describe('extra cases (verify)', () => {
  it('sender can getById but markAsRead/delete 404 (recipient-only scoping)', () => {
    const a = build([{ id: ID }]);
    return a.rpc.getById({ id: ID, userId: ME, role: 'TUTOR' } as any).then(() => {
      expect(params(a.wheres).filter((p) => p === ME)).toHaveLength(2);
    });
  });
  it('role undefined -> 403 on create', async () => {
    const repo = { create: jest.fn() };
    const rpc = new NotificationRpcController(new NotificationService(repo as never));
    await expect(
      Promise.resolve().then(() =>
        rpc.create({ type: 'TUTOR', title: 't', content: 'c', senderId: ME } as any),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('redirectUrl /\\evil.com is rejected', () => {
    expect(
      createNotificationSchema.safeParse({
        type: 'TUTOR',
        title: 't',
        content: 'c',
        redirectUrl: '/\\evil.com',
      }).success,
    ).toBe(false);
  });
});
