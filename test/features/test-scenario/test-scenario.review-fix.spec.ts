import 'reflect-metadata';
import { TestScenarioService } from 'src/features/test-scenario/test-scenario.service';
import { TestAuthService } from 'src/features/test-scenario/test-auth.service';
import { TestFixtureService } from 'src/features/test-scenario/test-fixture.service';
import { TestScenarioRpcController } from 'src/features/test-scenario/test-scenario.rpc.controller';
import { TestScenarioRepository } from 'src/features/test-scenario/test-scenario.repository';
import { TestFixtureRepository } from 'src/features/test-scenario/test-fixture.repository';

/**
 * Review-fix group D (F-05, F-15, F-21, F-22, F-37). These assert the CORRECT behaviour and are
 * expected to be RED until DEV lands the fixes.
 */

const BASE = 'http://localhost:8888';
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const okJson = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const baseScenario = {
  id: 's1',
  service: 'x',
  method: 'GET',
  path: '/users/me',
  name: 'n',
  category: 'valid',
  authProfile: 'admin',
  expectedStatus: 200,
  expectedMessage: null,
  requestTemplate: {},
};

describe('group D — test-scenario runner hardening', () => {
  const fetchMock = jest.fn();
  const env = { ...process.env };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.GATEWAY_BASE_URL = BASE;
    process.env.NODE_ENV = 'test';
    delete process.env.TEST_SCENARIO_ALLOW_WRITES;
    process.env.TEST_ACCOUNT_ADMIN = 'admin@x.dev:secret';
  });
  afterAll(() => {
    process.env = env;
  });

  const makeRunner = (scenario: object, auth?: object) => {
    const repo = { findById: jest.fn().mockResolvedValue({ ...baseScenario, ...scenario }), createRun: jest.fn((d) => d) };
    const authSvc = auth ?? { tokenFor: jest.fn(async () => 'ADMIN-TOKEN') };
    const service = new TestScenarioService(repo as never, authSvc as never, { valueFor: jest.fn() } as never);
    return { service, repo };
  };

  describe('F-05 origin lock', () => {
    it.each([
      ['userinfo trick', '@attacker.example/x'],
      ['protocol-relative', '//attacker.example/x'],
      ['no leading slash', 'attacker.example/x'],
    ])('scenario path (%s) is never fetched and the token never leaves', async (_l, path) => {
      fetchMock.mockResolvedValue(okJson(200, {}));
      const { service } = makeRunner({ path });
      const run = (await service.run('s1', { userId: 'u' })) as { passed: boolean; errorMessage?: string };

      expect(fetchMock).not.toHaveBeenCalled();
      expect(run.passed).toBe(false);
      expect(run.errorMessage).toBeTruthy();
    });

    it('a normal path still goes to the gateway origin', async () => {
      fetchMock.mockResolvedValue(okJson(200, {}));
      const { service } = makeRunner({});
      await service.run('s1', {});
      expect(new URL(fetchMock.mock.calls[0][0]).origin).toBe(BASE);
    });

    it('fixture resolver path to a foreign origin is rejected without fetching', async () => {
      fetchMock.mockResolvedValue(okJson(200, { id: 1 }));
      const row = {
        id: 'f1',
        key: 'k',
        value: null,
        resolver: { method: 'GET', path: '@attacker.example/x', authProfile: 'admin', extract: 'id' },
      };
      const repo = { findByKey: jest.fn().mockResolvedValue(row), update: jest.fn() };
      const svc = new TestFixtureService(repo as never, { tokenFor: jest.fn(async () => 'ADMIN-TOKEN') } as never);

      await expect(svc.valueFor('k')).rejects.toThrow();
      for (const call of fetchMock.mock.calls) {
        expect(new URL(call[0]).origin).toBe(BASE);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('F-15 write guard', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is blocked in production without the flag', async (method) => {
      process.env.NODE_ENV = 'production';
      fetchMock.mockResolvedValue(okJson(200, {}));
      const { service } = makeRunner({ method });
      const run = (await service.run('s1', {})) as { passed: boolean; errorMessage?: string };

      expect(fetchMock).not.toHaveBeenCalled();
      expect(run.passed).toBe(false);
      expect(run.errorMessage).toMatch(/TEST_SCENARIO_ALLOW_WRITES|write/i);
    });

    it('is allowed in production when TEST_SCENARIO_ALLOW_WRITES=true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_SCENARIO_ALLOW_WRITES = 'true';
      fetchMock.mockResolvedValue(okJson(200, {}));
      const { service } = makeRunner({ method: 'POST' });
      await service.run('s1', {});
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stays allowed outside production, and GET is always allowed', async () => {
      fetchMock.mockResolvedValue(okJson(200, {}));
      await makeRunner({ method: 'POST' }).service.run('s1', {});
      expect(fetchMock).toHaveBeenCalledTimes(1);

      process.env.NODE_ENV = 'production';
      await makeRunner({ method: 'GET' }).service.run('s1', {});
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('F-21 RPC payload validation', () => {
    const invoke = async (method: keyof TestScenarioRpcController, payload: unknown, controller: TestScenarioRpcController) => {
      const handler = controller[method] as unknown as (p: unknown) => unknown;
      let value = payload;
      const metas: unknown[] = [
        ...(Reflect.getMetadata('__pipes__', TestScenarioRpcController) ?? []),
        ...(Reflect.getMetadata('__pipes__', handler) ?? []),
      ];
      const args = Reflect.getMetadata('__routeArguments__', TestScenarioRpcController, method as string) ?? {};
      for (const a of Object.values(args) as { pipes?: unknown[] }[]) metas.push(...(a.pipes ?? []));
      for (const p of metas) {
        const inst = typeof p === 'function' ? new (p as new () => { transform: Function })() : (p as { transform: Function });
        value = await inst.transform(value, { type: 'body' });
      }
      return handler.call(controller, value);
    };

    let service: Record<string, jest.Mock>;
    let fixtures: Record<string, jest.Mock>;
    let controller: TestScenarioRpcController;
    beforeEach(() => {
      service = Object.fromEntries(
        ['create', 'update', 'createMany', 'run', 'generate'].map((k) => [k, jest.fn().mockResolvedValue({})]),
      );
      fixtures = Object.fromEntries(['create', 'update', 'resolve'].map((k) => [k, jest.fn().mockResolvedValue({})]));
      controller = new TestScenarioRpcController(service as never, fixtures as never, {} as never);
    });

    const goodScenario = { service: 's', method: 'GET', path: '/a', name: 'n', expectedStatus: 200 };

    it('create rejects an off-origin path and a bad method', async () => {
      await expect(invoke('create', { ...goodScenario, path: '@evil.example/x' }, controller)).rejects.toBeDefined();
      await expect(invoke('create', { ...goodScenario, method: 'TRACE' }, controller)).rejects.toBeDefined();
      expect(service.create).not.toHaveBeenCalled();
    });

    it('create strips unknown fields (id, createdAt) before reaching the service', async () => {
      await invoke('create', { ...goodScenario, id: 'forced', createdAt: 'x' }, controller);
      const arg = service.create.mock.calls[0][0];
      expect(arg).not.toHaveProperty('id');
      expect(arg).not.toHaveProperty('createdAt');
    });

    it('update rejects a bad path', async () => {
      await expect(invoke('update', { id: 'a', dto: { path: '//evil.example' } }, controller)).rejects.toBeDefined();
      expect(service.update).not.toHaveBeenCalled();
    });

    it('createMany rejects an invalid entry', async () => {
      await expect(
        invoke('createMany', { scenarios: [goodScenario, { ...goodScenario, path: '@evil.example' }] }, controller),
      ).rejects.toBeDefined();
      expect(service.createMany).not.toHaveBeenCalled();
    });

    it('fixtures.create rejects a bad key and a bad resolver path', async () => {
      await expect(invoke('createFixture', { key: '1bad key', value: 'v' }, controller)).rejects.toBeDefined();
      await expect(
        invoke('createFixture', { key: 'ok', resolver: { path: '@evil.example', extract: 'a' } }, controller),
      ).rejects.toBeDefined();
      expect(fixtures.create).not.toHaveBeenCalled();
    });

    it('fixtures.update rejects a bad resolver path', async () => {
      await expect(
        invoke('updateFixture', { id: 'a', dto: { resolver: { path: '//evil', extract: 'a' } } }, controller),
      ).rejects.toBeDefined();
      expect(fixtures.update).not.toHaveBeenCalled();
    });

    it('run rejects a payload without a string id', async () => {
      await expect(invoke('run', { id: 123 }, controller)).rejects.toBeDefined();
      expect(service.run).not.toHaveBeenCalled();
    });

    it('scenario repository create/update only pass allowed fields to drizzle', async () => {
      const returning = jest.fn().mockResolvedValue([{}]);
      const values = jest.fn(() => ({ returning }));
      const where = jest.fn(() => ({ returning }));
      const set = jest.fn(() => ({ where }));
      const db = { insert: jest.fn(() => ({ values })), update: jest.fn(() => ({ set })) };
      const repo = new TestScenarioRepository(db as never);
      const dirty = { ...goodScenario, id: 'forced', createdAt: 'x', updatedAt: 'y' } as never;

      await repo.create(dirty);
      await repo.update('id1', dirty);

      for (const arg of [(values.mock.calls[0] as unknown[])[0], (set.mock.calls[0] as unknown[])[0]] as object[]) {
        expect(arg).not.toHaveProperty('id');
        expect(arg).not.toHaveProperty('createdAt');
        expect(arg).not.toHaveProperty('updatedAt');
        expect(arg).toHaveProperty('path', '/a');
      }
    });

    it('fixture repository create/update only pass allowed fields to drizzle', async () => {
      const returning = jest.fn().mockResolvedValue([{}]);
      const values = jest.fn(() => ({ returning }));
      const where = jest.fn(() => ({ returning }));
      const set = jest.fn(() => ({ where }));
      const db = { insert: jest.fn(() => ({ values })), update: jest.fn(() => ({ set })) };
      const repo = new TestFixtureRepository(db as never);
      const dirty = { key: 'k', value: 'v', id: 'forced', createdAt: 'x' } as never;

      await repo.create(dirty);
      await repo.update('id1', dirty);

      for (const arg of [(values.mock.calls[0] as unknown[])[0], (set.mock.calls[0] as unknown[])[0]] as object[]) {
        expect(arg).not.toHaveProperty('id');
        expect(arg).not.toHaveProperty('createdAt');
        expect(arg).toHaveProperty('key', 'k');
      }
    });
  });

  describe('F-22 fixtures.list hides values', () => {
    it('returns hasValue instead of the raw value', async () => {
      const rows = [
        { id: '1', key: 'a', value: 'SUPER-SECRET', resolver: null },
        { id: '2', key: 'b', value: null, resolver: null },
      ];
      const repo = { findAll: jest.fn().mockResolvedValue(rows) };
      const svc = new TestFixtureService(repo as never, {} as never);
      const list = (await svc.findAll()) as Array<Record<string, unknown>>;

      expect(JSON.stringify(list)).not.toContain('SUPER-SECRET');
      expect(list[0].hasValue).toBe(true);
      expect(list[1].hasValue).toBe(false);
    });

    it('resolve still returns the value to the caller (runner needs it)', async () => {
      const repo = { findById: jest.fn().mockResolvedValue({ id: '1', key: 'a', value: 'V', resolver: null }) };
      const svc = new TestFixtureService(repo as never, {} as never);
      await expect(svc.resolve('1')).resolves.toMatchObject({ value: 'V' });
    });
  });

  describe('F-37 account privacy and 401 handling', () => {
    it('statuses masks the email', () => {
      process.env.TEST_ACCOUNT_STUDENT = 'student@x.dev:pw';
      const status = new TestAuthService().statuses().find((s) => s.profile === 'student')!;
      expect(status.configured).toBe(true);
      expect(status.email).not.toBe('student@x.dev');
      expect(status.email).toMatch(/^s\*+@x\.dev$/);
    });

    it('login failure message does not contain the email', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
      const auth = new TestAuthService();
      const err = await auth.tokenFor('admin').catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain('admin@x.dev');
    });

    it('a 401 from the gateway drops the cached token so the next run logs in again', async () => {
      const token = jwt(Math.floor(Date.now() / 1000) + 3600);
      fetchMock.mockImplementation(async (url: string) =>
        String(url).endsWith('/auth/login') ? okJson(200, { data: { accessToken: token } }) : okJson(401, { message: 'Unauthorized' }),
      );
      const auth = new TestAuthService();
      const { service } = makeRunner({}, auth);

      await service.run('s1', {});
      await service.run('s1', {});

      const logins = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/login'));
      expect(logins).toHaveLength(2);
    });
  });
});

describe('group D — VERIFY edge cases', () => {
  const fetchMock = jest.fn();
  const env = { ...process.env };
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.NODE_ENV = 'test';
  });
  afterAll(() => {
    process.env = env;
  });
  const run = async (path: string) => {
    fetchMock.mockResolvedValue(okJson(200, {}));
    const repo = { findById: jest.fn().mockResolvedValue({ ...baseScenario, path, authProfile: 'admin' }), createRun: jest.fn((d) => d) };
    const svc = new TestScenarioService(repo as never, { tokenFor: jest.fn(async () => 'T'), invalidate: jest.fn() } as never, {} as never);
    return svc.run('s1', {});
  };

  it("path '/a@b' stays on the gateway origin", async () => {
    process.env.GATEWAY_BASE_URL = BASE;
    await run('/a@b');
    expect(new URL(fetchMock.mock.calls[0][0]).origin).toBe(BASE);
  });

  it('backslash path is refused', async () => {
    process.env.GATEWAY_BASE_URL = BASE;
    await run('/\\evil.example');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GATEWAY_BASE_URL with a path prefix is preserved', async () => {
    process.env.GATEWAY_BASE_URL = `${BASE}/api/`;
    await run('/users/me');
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/users/me`);
  });

  it('RPC pipe turns a bad payload into 422', async () => {
    const { UnprocessableEntityException } = await import('@nestjs/common');
    const controller = new TestScenarioRpcController({ create: jest.fn() } as never, {} as never, {} as never);
    const args = Reflect.getMetadata('__routeArguments__', TestScenarioRpcController, 'create') ?? {};
    const pipes = (Object.values(args) as { pipes?: { transform: Function }[] }[]).flatMap((a) => a.pipes ?? []);
    expect(pipes.length).toBeGreaterThan(0);
    expect(() => pipes[0].transform({ path: '@evil', name: 'n' })).toThrow(UnprocessableEntityException);
    expect(controller).toBeDefined();
  });
});
