import { Logger, NotFoundException } from '@nestjs/common';
import { TestScenarioService, formatResponseBody, judgeRun } from 'src/features/test-scenario/test-scenario.service';
import type { TestScenarioRepository } from 'src/features/test-scenario/test-scenario.repository';
import type { TestAuthService } from 'src/features/test-scenario/test-auth.service';
import type { TestFixtureService } from 'src/features/test-scenario/test-fixture.service';

/** `caller` → the caller's token, `none` → nothing, a role → `<role>-token`. */
const authStub = () => ({
  tokenFor: jest.fn(async (profile: string, caller?: string) =>
    profile === 'caller' ? caller : profile === 'none' ? undefined : `${profile}-token`,
  ),
});

const scenario = {
  id: 's1',
  method: 'GET',
  path: '/users/me',
  expectedStatus: 401,
  expectedMessage: 'Unauthorized',
  requestTemplate: { headers: { authorization: 'Bearer {{accessToken}}' } },
};

describe('TestScenarioService.run', () => {
  let repo: { findById: jest.Mock; createRun: jest.Mock };
  let fixtures: { valueFor: jest.Mock };
  let service: TestScenarioService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    repo = { findById: jest.fn().mockResolvedValue(scenario), createRun: jest.fn((d) => d) };
    fixtures = { valueFor: jest.fn() };
    service = new TestScenarioService(
      repo as unknown as TestScenarioRepository,
      authStub() as unknown as TestAuthService,
      fixtures as unknown as TestFixtureService,
    );
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('passes when the actual status equals the expected one and tags the correlation id', async () => {
    fetchMock.mockResolvedValue({ status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) });
    const run = await service.run('s1', { userId: 'u1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/users\/me$/);
    expect(init.headers['x-correlation-id']).toBe(run.correlationId);
    expect(run).toMatchObject({ actualStatus: 401, passed: true, triggeredBy: 'u1' });
  });

  it('drops a {{accessToken}} header when the caller has no token', async () => {
    fetchMock.mockResolvedValue({ status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) });
    await service.run('s1', {});
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it('substitutes the caller token into the header', async () => {
    fetchMock.mockResolvedValue({ status: 200, text: async () => JSON.stringify({ message: 'Thành công' }) });
    const run = await service.run('s1', { accessToken: 'abc' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer abc');
    expect(run).toMatchObject({ passed: false });
  });

  it('adds the caller token when the template has no authorization header', async () => {
    repo.findById.mockResolvedValue({ ...scenario, category: 'valid', requestTemplate: {}, expectedStatus: 200, expectedMessage: 'Thành công' });
    fetchMock.mockResolvedValue({ status: 200, text: async () => JSON.stringify({ message: 'Thành công' }) });
    await service.run('s1', { accessToken: 'abc' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer abc');
  });

  it('leaves auth-category cases without a token header untouched', async () => {
    repo.findById.mockResolvedValue({ ...scenario, category: 'auth', requestTemplate: {} });
    fetchMock.mockResolvedValue({ status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) });
    await service.run('s1', { accessToken: 'abc' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it('records a failed run (no status) on transport errors', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const run = await service.run('s1', {});
    expect(run).toMatchObject({ actualStatus: null, passed: false, errorMessage: 'ECONNREFUSED' });
  });

  it('with wait:false returns the correlation id at once and still records the run', async () => {
    let release!: () => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) });
      }),
    );
    const out = await service.run('s1', {}, { wait: false });

    expect(out).toEqual({ correlationId: expect.any(String), scenarioId: 's1' });
    expect(repo.createRun).not.toHaveBeenCalled();

    release();
    await new Promise((r) => setImmediate(r));
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: out.correlationId, passed: true }),
    );
  });

  it('throws NotFound for an unknown scenario', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.run('nope', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('runs as a role profile and sends its token even on auth-category cases', async () => {
    repo.findById.mockResolvedValue({ ...scenario, category: 'auth', authProfile: 'student', requestTemplate: {}, expectedStatus: 403, expectedMessage: 'Forbidden' });
    fetchMock.mockResolvedValue({ status: 403, text: async () => JSON.stringify({ message: 'Forbidden' }) });
    await service.run('s1', { accessToken: 'admin-caller' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer student-token');
  });

  it('sends no token for the none profile', async () => {
    repo.findById.mockResolvedValue({ ...scenario, category: 'valid', authProfile: 'none' });
    fetchMock.mockResolvedValue({ status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) });
    const run = await service.run('s1', { accessToken: 'abc' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBeUndefined();
    expect(run).toMatchObject({ passed: true });
  });

  it('fills fixtures, built-ins and other roles\' tokens into path, headers and body', async () => {
    fixtures.valueFor.mockResolvedValue('class-42');
    repo.findById.mockResolvedValue({
      ...scenario,
      method: 'PUT',
      path: '/classes/{{fixture.classId}}/students/{{unknownUuid}}',
      expectedStatus: 200,
      expectedMessage: 'Thành công',
      requestTemplate: {
        headers: { 'x-other': '{{token.tutor}}' },
        body: { classId: '{{fixture.classId}}', email: '{{random.email}}' },
      },
    });
    fetchMock.mockResolvedValue({ status: 200, text: async () => JSON.stringify({ message: 'Thành công' }) });
    const run = await service.run('s1', { accessToken: 'abc' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/classes\/class-42\/students\/00000000-0000-4000-8000-000000000000$/);
    expect(init.headers['x-other']).toBe('tutor-token');
    const body = JSON.parse(init.body);
    expect(body.classId).toBe('class-42');
    expect(body.email).toMatch(/^test\+\w{8}@example\.com$/);
    expect(fixtures.valueFor).toHaveBeenCalledWith('classId', 'abc');
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ requestPath: expect.stringContaining('/classes/class-42/') }),
    );
    expect(run).toMatchObject({ passed: true });
  });

  it('records a failed run without sending anything when a variable cannot be filled', async () => {
    fixtures.valueFor.mockRejectedValue(new Error('Unknown fixture "nope"'));
    repo.findById.mockResolvedValue({ ...scenario, path: '/classes/{{fixture.nope}}' });
    const run = await service.run('s1', { accessToken: 'abc' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(run).toMatchObject({
      actualStatus: null,
      passed: false,
      errorMessage: 'Setup failed: Unknown fixture "nope"',
      requestPath: '/classes/{{fixture.nope}}',
    });
  });

  it('rejects unknown variables', async () => {
    repo.findById.mockResolvedValue({ ...scenario, path: '/x/{{whatever}}' });
    const run = await service.run('s1', {});
    expect(run).toMatchObject({ errorMessage: 'Setup failed: unknown variable {{whatever}}' });
  });

  it('records the response body with secrets redacted', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ data: { accessToken: 'jwt', id: 'u1' } }),
    });
    await service.run('s1', {});
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ responseBody: '{"data":{"accessToken":"[REDACTED]","id":"u1"}}' }),
    );
  });
});

describe('formatResponseBody', () => {
  it('keeps non-JSON bodies and drops empty ones', () => {
    expect(formatResponseBody('<html>oops</html>')).toBe('<html>oops</html>');
    expect(formatResponseBody('')).toBeUndefined();
  });

  it('truncates very long bodies', () => {
    const out = formatResponseBody('x'.repeat(5000))!;
    expect(out.endsWith('…(truncated)')).toBe(true);
    expect(out.length).toBeLessThan(4100);
  });
});

describe('TestScenarioService.findRuns', () => {
  it('clamps the limit and 404s on an unknown scenario', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(scenario),
      findRuns: jest.fn().mockResolvedValue([]),
    };
    const service = new TestScenarioService(
      repo as unknown as TestScenarioRepository,
      authStub() as unknown as TestAuthService,
      { valueFor: jest.fn() } as unknown as TestFixtureService,
    );

    await service.findRuns('s1', 500);
    expect(repo.findRuns).toHaveBeenCalledWith('s1', 100);

    repo.findById.mockResolvedValue(null);
    await expect(service.findRuns('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TestScenarioService.generate / createMany', () => {
  const repo = {
    existingKeys: jest.fn(),
    createMany: jest.fn(async (rows: unknown[]) => rows),
  };
  const fixtures = { findAll: jest.fn() };
  const service = new TestScenarioService(
    repo as unknown as TestScenarioRepository,
    authStub() as unknown as TestAuthService,
    fixtures as unknown as TestFixtureService,
  );
  const detailRoute = {
    method: 'GET',
    path: '/classes/:id',
    summary: null,
    tag: null,
    params: ['id'],
    uuidParams: ['id'],
    isPublic: false,
    roles: null,
    bodySchema: null,
    querySchema: null,
    multipart: false,
    oauth: false,
  };

  it('flags proposals and fixtures that already exist', async () => {
    repo.existingKeys.mockResolvedValue(new Set(['GET /classes/{{unknownUuid}} Không có token']));
    fixtures.findAll.mockResolvedValue([{ key: 'classId' }]);
    const out = await service.generate({ routes: [detailRoute], categories: ['valid', 'auth'] });

    expect(out.scenarios.map((s) => [s.name, s.exists])).toEqual([
      ['Request hợp lệ', false],
      ['Không có token', true],
      ['Token không hợp lệ', false],
    ]);
    expect(out.fixtures).toEqual([{ key: 'classId', exists: true, suggestion: null }]);
  });

  it('skips duplicates against the database and within the batch', async () => {
    repo.existingKeys.mockResolvedValue(new Set(['GET /a old']));
    const row = (path: string, name: string) => ({
      service: 'gateway',
      method: 'GET' as const,
      path,
      name,
      requestTemplate: {},
      expectedStatus: 200,
      expectedMessage: 'Thành công',
      category: 'valid' as const,
      authProfile: 'caller' as const,
    });
    const out = await service.createMany([row('/a', 'old'), row('/a', 'new'), row('/a', 'new')]);
    expect(out).toEqual({ created: 1, skipped: 2 });
    expect(repo.createMany).toHaveBeenCalledWith([row('/a', 'new')]);
  });
});

describe('judgeRun', () => {
  const body = (message: string) => JSON.stringify({ statusCode: 422, message });

  it('passes only when status and message both match', () => {
    expect(judgeRun({ expectedStatus: 422, expectedMessage: 'Dữ liệu không hợp lệ' }, 422, body('Dữ liệu không hợp lệ')).passed).toBe(true);
  });

  it('matches the message as a case-insensitive substring', () => {
    expect(judgeRun({ expectedStatus: 422, expectedMessage: 'dữ liệu' }, 422, body('Dữ liệu không hợp lệ')).passed).toBe(true);
  });

  it('fails when the status is right but the message differs, and says what was received', () => {
    const v = judgeRun({ expectedStatus: 422, expectedMessage: 'Không tìm thấy' }, 422, body('Dữ liệu không hợp lệ'));
    expect(v.passed).toBe(false);
    expect(v.errorMessage).toContain('Dữ liệu không hợp lệ');
  });

  it('fails when the status is wrong even if the message matches', () => {
    expect(judgeRun({ expectedStatus: 200, expectedMessage: 'Dữ liệu' }, 422, body('Dữ liệu không hợp lệ')).passed).toBe(false);
  });

  it('fails a case with no expectedMessage, so an unverified message never passes silently', () => {
    const v = judgeRun({ expectedStatus: 422, expectedMessage: null }, 422, body('Dữ liệu không hợp lệ'));
    expect(v.passed).toBe(false);
    expect(v.errorMessage).toContain('Thiếu expectedMessage');
  });

  it('fails when the response has no JSON message', () => {
    const v = judgeRun({ expectedStatus: 500, expectedMessage: 'x' }, 500, '<html>oops</html>');
    expect(v.passed).toBe(false);
    expect(v.errorMessage).toContain('(không có message)');
  });
});

describe('TestScenarioService — CRUD and run edge cases', () => {
  let repo: Record<string, jest.Mock>;
  let fixtures: { valueFor: jest.Mock };
  let auth: ReturnType<typeof authStub>;
  let service: TestScenarioService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    repo = {
      create: jest.fn(async (d: object) => ({ id: 'new', ...d })),
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn(async (id: string, d: object) => ({ ...scenario, id, ...d })),
      delete: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(scenario),
      createRun: jest.fn((d) => d),
      statsByEndpoint: jest.fn().mockResolvedValue([{ method: 'GET', path: '/x', casesTotal: 1, casesPassed: 1 }]),
    };
    fixtures = { valueFor: jest.fn() };
    auth = authStub();
    service = new TestScenarioService(
      repo as unknown as TestScenarioRepository,
      auth as unknown as TestAuthService,
      fixtures as unknown as TestFixtureService,
    );
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({ status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) });
  });

  it('create stores the dto as given', async () => {
    const dto = { method: 'GET', path: '/users/me', expectedStatus: 200 };
    await expect(service.create(dto as never)).resolves.toEqual({ id: 'new', ...dto });
    expect(repo.create).toHaveBeenCalledWith(dto);
  });

  it('findAll passes the query through to the repository', async () => {
    const query = { service: 'user-service', method: 'GET' };
    await service.findAll(query as never);
    expect(repo.findAll).toHaveBeenCalledWith(query);
  });

  it('update returns the updated row', async () => {
    await expect(service.update('s1', { name: 'renamed' } as never)).resolves.toMatchObject({
      id: 's1',
      name: 'renamed',
    });
  });

  it('update throws NotFound for an unknown scenario', async () => {
    repo.update.mockResolvedValue(null);
    await expect(service.update('ghost', { name: 'x' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delete returns the removed row and throws NotFound when nothing was removed', async () => {
    repo.delete.mockResolvedValueOnce({ id: 's1' });
    await expect(service.delete('s1')).resolves.toEqual({ id: 's1' });

    await expect(service.delete('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stats delegates to the repository aggregate', async () => {
    await expect(service.stats()).resolves.toEqual([
      { method: 'GET', path: '/x', casesTotal: 1, casesPassed: 1 },
    ]);
  });

  it('run throws NotFound for an unknown scenario before touching the network', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.run('ghost', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records a setup failure when a {{token.<role>}} variable names an unknown profile', async () => {
    repo.findById.mockResolvedValue({ ...scenario, path: '/x/{{token.wizard}}' });
    const run = await service.run('s1', {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(run).toMatchObject({
      passed: false,
      actualStatus: null,
      errorMessage: 'Setup failed: unknown auth profile in {{token.wizard}}',
    });
  });

  it('records a setup failure for an unknown built-in variable', async () => {
    repo.findById.mockResolvedValue({ ...scenario, path: '/x/{{nonsense}}' });
    const run = await service.run('s1', {});
    expect(run.errorMessage).toBe('Setup failed: unknown variable {{nonsense}}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fills {{token.<role>}} with that role\'s token', async () => {
    repo.findById.mockResolvedValue({
      ...scenario,
      expectedStatus: 200,
      requestTemplate: { headers: { authorization: 'Bearer {{token.tutor}}' } },
    });
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{"message":"ok"}' });
    await service.run('s1', {});
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer tutor-token');
  });

  it('records a setup failure when a token variable is empty but used in the path', async () => {
    repo.findById.mockResolvedValue({
      ...scenario,
      authProfile: 'none',
      path: '/users/{{accessToken}}',
    });
    const run = await service.run('s1', {});
    expect(run.errorMessage).toBe(
      'Setup failed: a token variable has no value for auth profile "none"',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records a setup failure when an empty token is used in the body', async () => {
    repo.findById.mockResolvedValue({
      ...scenario,
      authProfile: 'none',
      requestTemplate: { body: { token: '{{accessToken}}' } },
    });
    const run = await service.run('s1', {});
    expect(run.errorMessage).toContain('a token variable has no value');
  });

  it('logs a warning instead of throwing when a background run cannot be recorded', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    repo.createRun.mockRejectedValueOnce(new Error('db gone'));
    fetchMock.mockResolvedValue({ status: 401, text: async () => '{"message":"Unauthorized"}' });

    const out = await service.run('s1', {}, { wait: false });
    expect(out.correlationId).toEqual(expect.any(String));
    await new Promise((r) => setImmediate(r));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db gone'));
    warn.mockRestore();
  });
});
