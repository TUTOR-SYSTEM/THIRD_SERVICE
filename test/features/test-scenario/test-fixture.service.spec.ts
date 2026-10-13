import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FixtureError, TestFixtureService } from 'src/features/test-scenario/test-fixture.service';
import type { TestFixtureRepository } from 'src/features/test-scenario/test-fixture.repository';
import type { TestAuthService } from 'src/features/test-scenario/test-auth.service';

const resolverFixture = {
  id: 'f1',
  key: 'classId',
  value: null as string | null,
  resolver: { method: 'GET', path: '/classes?limit=1', authProfile: 'admin', extract: 'data.classes.0.id' },
};

describe('TestFixtureService', () => {
  const fetchMock = jest.fn();
  let repo: Record<'findByKey' | 'findById' | 'update' | 'create', jest.Mock>;
  let auth: { tokenFor: jest.Mock };
  let service: TestFixtureService;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    repo = {
      findByKey: jest.fn().mockResolvedValue({ ...resolverFixture }),
      findById: jest.fn().mockResolvedValue({ ...resolverFixture }),
      update: jest.fn(async (id: string, data: object) => ({ ...resolverFixture, id, ...data })),
      create: jest.fn(),
    };
    auth = { tokenFor: jest.fn().mockResolvedValue('admin-token') };
    service = new TestFixtureService(
      repo as unknown as TestFixtureRepository,
      auth as unknown as TestAuthService,
    );
  });

  it('returns a cached or fixed value without fetching', async () => {
    repo.findByKey.mockResolvedValue({ ...resolverFixture, value: 'cached' });
    await expect(service.valueFor('classId')).resolves.toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves on first use as the resolver profile and caches the value', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 42 }] } }) });
    await expect(service.valueFor('classId', 'caller')).resolves.toBe('42');

    expect(auth.tokenFor).toHaveBeenCalledWith('admin', 'caller');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/classes\?limit=1$/);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ authorization: 'Bearer admin-token' });
    expect(repo.update).toHaveBeenCalledWith('f1', { value: '42', resolvedAt: expect.any(Date) });
  });

  it('explains unknown fixtures and empty extracts', async () => {
    repo.findByKey.mockResolvedValue(null);
    await expect(service.valueFor('nope')).rejects.toThrow('Unknown fixture "nope"');

    repo.findByKey.mockResolvedValue({ ...resolverFixture });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [] } }) });
    await expect(service.valueFor('classId')).rejects.toThrow('nothing at "data.classes.0.id"');
  });

  it('turns a failed manual resolve into a 400 that names the cause', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const error = await service.resolve('f1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe(
      'TEST_FIXTURE_RESOLVE_FAILED: Fixture "classId": GET /classes?limit=1 returned 403',
    );
  });

  it('rejects a duplicate key and clears the cached value when the resolver changes', async () => {
    await expect(service.create({ key: 'classId', value: 'x' })).rejects.toBeInstanceOf(ConflictException);

    repo.findByKey.mockResolvedValue(null);
    const resolver = { method: 'GET' as const, path: '/classes', authProfile: 'admin' as const, extract: 'data.0.id' };
    await service.update('f1', { resolver });
    expect(repo.update).toHaveBeenCalledWith('f1', { resolver, value: null, resolvedAt: null });
  });
});

describe('TestFixtureService — full case matrix', () => {
  const fetchMock = jest.fn();
  const savedBase = process.env.GATEWAY_BASE_URL;
  let repo: Record<'findAll' | 'findByKey' | 'findById' | 'update' | 'create' | 'delete', jest.Mock>;
  let auth: { tokenFor: jest.Mock };
  let service: TestFixtureService;

  const fixed = { id: 'fx', key: 'fixedKey', value: 'hello', resolver: null };
  const resolving = { ...resolverFixture, value: null as string | null };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.GATEWAY_BASE_URL;
    repo = {
      findAll: jest.fn().mockResolvedValue([fixed]),
      findByKey: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      update: jest.fn(async (id: string, data: object) => ({ ...resolving, id, ...data })),
      create: jest.fn(async (dto: object) => ({ id: 'new', ...dto })),
      delete: jest.fn().mockResolvedValue(null),
    };
    auth = { tokenFor: jest.fn().mockResolvedValue('admin-token') };
    service = new TestFixtureService(
      repo as unknown as TestFixtureRepository,
      auth as unknown as TestAuthService,
    );
  });

  afterAll(() => {
    if (savedBase === undefined) delete process.env.GATEWAY_BASE_URL;
    else process.env.GATEWAY_BASE_URL = savedBase;
  });

  describe('CRUD', () => {
    it('findAll delegates to the repository', async () => {
      await expect(service.findAll()).resolves.toEqual([{ ...fixed, value: null, hasValue: fixed.value != null }]);
      expect(repo.findAll).toHaveBeenCalledTimes(1);
    });

    it('create stores a fixture whose key is free', async () => {
      const dto = { key: 'brandNew', value: 'v' };
      await expect(service.create(dto as never)).resolves.toEqual({ id: 'new', ...dto });
      expect(repo.create).toHaveBeenCalledWith(dto);
    });

    it('create rejects a key that another fixture already uses', async () => {
      repo.findByKey.mockResolvedValue(fixed);
      await expect(service.create({ key: 'fixedKey', value: 'x' } as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('update allows keeping the same key on the same fixture', async () => {
      repo.findByKey.mockResolvedValue({ ...fixed, id: 'fx' });
      await expect(service.update('fx', { key: 'fixedKey', value: 'v2' } as never)).resolves.toBeDefined();
      expect(repo.update).toHaveBeenCalledWith('fx', { key: 'fixedKey', value: 'v2' });
    });

    it('update rejects renaming onto another fixture key', async () => {
      repo.findByKey.mockResolvedValue({ ...fixed, id: 'someone-else' });
      await expect(service.update('fx', { key: 'fixedKey' } as never)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('update skips the key check when no key is sent', async () => {
      await service.update('fx', { value: 'v3' } as never);
      expect(repo.findByKey).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('fx', { value: 'v3' });
    });

    it('update with a new resolver AND an explicit value keeps the given value', async () => {
      const dto = { resolver: { method: 'GET', path: '/x', authProfile: 'admin', extract: 'a' }, value: 'manual' };
      await service.update('fx', dto as never);
      expect(repo.update).toHaveBeenCalledWith('fx', dto);
    });

    it('update with a resolver-only change clears the cached value and resolvedAt', async () => {
      const resolver = { method: 'GET', path: '/y', authProfile: 'none', extract: 'b' };
      await service.update('fx', { resolver } as never);
      expect(repo.update).toHaveBeenCalledWith('fx', { resolver, value: null, resolvedAt: null });
    });

    it('update does not invalidate the cache for a value-only change', async () => {
      await service.update('fx', { value: 'new' } as never);
      expect(repo.update).toHaveBeenCalledWith('fx', { value: 'new' });
    });

    it('update throws NotFound when the row does not exist', async () => {
      repo.update.mockResolvedValue(null);
      await expect(service.update('ghost', { value: 'x' } as never)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('delete returns the removed row', async () => {
      repo.delete.mockResolvedValue(fixed);
      await expect(service.delete('fx')).resolves.toEqual(fixed);
    });

    it('delete throws NotFound when nothing was removed', async () => {
      await expect(service.delete('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('valueFor', () => {
    it('throws FixtureError for an unknown key', async () => {
      await expect(service.valueFor('nope')).rejects.toBeInstanceOf(FixtureError);
    });

    it('returns a fixed value directly, without touching auth or the network', async () => {
      repo.findByKey.mockResolvedValue(fixed);
      await expect(service.valueFor('fixedKey')).resolves.toBe('hello');
      expect(auth.tokenFor).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats an empty-string cached value as a real value', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving, value: '' });
      await expect(service.valueFor('classId')).resolves.toBe('');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws FixtureError when the fixture has neither a value nor a resolver', async () => {
      repo.findByKey.mockResolvedValue({ id: 'e', key: 'empty', value: null, resolver: null });
      await expect(service.valueFor('empty')).rejects.toThrow('Fixture "empty" has no value');
    });

    it('wraps a network failure into FixtureError naming the path', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const error = await service.valueFor('classId').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FixtureError);
      expect((error as Error).message).toBe(
        'Fixture "classId": GET /classes?limit=1 failed (ECONNREFUSED)',
      );
    });

    it('stringifies a non-Error network rejection', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockRejectedValue('timeout-string');
      await expect(service.valueFor('classId')).rejects.toThrow('failed (timeout-string)');
    });

    it('reports the HTTP status when the gateway answers non-2xx', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
      await expect(service.valueFor('classId')).rejects.toThrow(
        'Fixture "classId": GET /classes?limit=1 returned 500',
      );
    });

    it('treats a body that is not JSON as "nothing at extract path"', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('bad json')),
      });
      await expect(service.valueFor('classId')).rejects.toThrow(
        'nothing at "data.classes.0.id" in GET /classes?limit=1',
      );
    });

    it('treats an explicit null at the extract path as missing', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { classes: [{ id: null }] } }),
      });
      await expect(service.valueFor('classId')).rejects.toBeInstanceOf(FixtureError);
    });

    it('JSON-encodes a non-string extracted value (number and object)', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 7 }] } }) });
      await expect(service.valueFor('classId')).resolves.toBe('7');
      expect(repo.update).toHaveBeenLastCalledWith('f1', { value: '7', resolvedAt: expect.any(Date) });

      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { classes: [{ id: { nested: true } }] } }),
      });
      await expect(service.valueFor('classId')).resolves.toBe('{"nested":true}');
    });

    it('falls back to the in-memory value when the cache update returns no row', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      repo.update.mockResolvedValue(null);
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 'z' }] } }) });
      await expect(service.valueFor('classId')).resolves.toBe('z');
    });

    it('sends no Authorization header when the profile yields no token', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      auth.tokenFor.mockResolvedValue(undefined);
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 1 }] } }) });
      await service.valueFor('classId');
      expect(fetchMock.mock.calls[0][1].headers).toEqual({});
    });

    it('uses GATEWAY_BASE_URL and strips trailing slashes from it', async () => {
      process.env.GATEWAY_BASE_URL = 'https://gw.example.test///';
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 1 }] } }) });
      await service.valueFor('classId');
      expect(fetchMock.mock.calls[0][0]).toBe('https://gw.example.test/classes?limit=1');
    });

    it('defaults the gateway base URL to localhost:8888', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 1 }] } }) });
      await service.valueFor('classId');
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8888/classes?limit=1');
    });

    it('passes the caller token through to the auth profile lookup', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 1 }] } }) });
      await service.valueFor('classId', 'caller-jwt');
      expect(auth.tokenFor).toHaveBeenCalledWith('admin', 'caller-jwt');
    });

    it('aborts the fetch after the resolve timeout', async () => {
      repo.findByKey.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 1 }] } }) });
      await service.valueFor('classId');
      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });
  });

  describe('resolve (manual "resolve now")', () => {
    it('throws NotFound for an unknown fixture id', async () => {
      await expect(service.resolve('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns a fixed fixture as is, without fetching', async () => {
      repo.findById.mockResolvedValue(fixed);
      await expect(service.resolve('fx')).resolves.toBe(fixed);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('re-fetches a resolver fixture and returns the refreshed row', async () => {
      repo.findById.mockResolvedValue({ ...resolving });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { classes: [{ id: 'r' }] } }) });
      const row = await service.resolve('f1');
      expect(row).toEqual(expect.objectContaining({ value: 'r' }));
      expect(repo.update).toHaveBeenCalledWith('f1', { value: 'r', resolvedAt: expect.any(Date) });
    });

    it('turns an auth-profile failure into a 400 that keeps the original message', async () => {
      repo.findById.mockResolvedValue({ ...resolving });
      auth.tokenFor.mockRejectedValue(new Error('TEST_ACCOUNT_ADMIN missing'));
      const error = await service.resolve('f1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(
        'TEST_FIXTURE_RESOLVE_FAILED: TEST_ACCOUNT_ADMIN missing',
      );
    });

    it('stringifies non-Error failures in the 400 message', async () => {
      repo.findById.mockResolvedValue({ ...resolving });
      auth.tokenFor.mockRejectedValue('plain-string');
      await expect(service.resolve('f1')).rejects.toThrow('TEST_FIXTURE_RESOLVE_FAILED: plain-string');
    });
  });
});
