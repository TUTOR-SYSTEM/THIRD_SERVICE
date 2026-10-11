import { Logger } from '@nestjs/common';
import {
  TestScenarioService,
  extractMessage,
} from 'src/features/test-scenario/test-scenario.service';
import type { TestScenarioRepository } from 'src/features/test-scenario/test-scenario.repository';
import type { TestAuthService } from 'src/features/test-scenario/test-auth.service';
import type { TestFixtureService } from 'src/features/test-scenario/test-fixture.service';

const scenario = {
  id: 's1',
  method: 'GET',
  path: '/users/me',
  expectedStatus: 200,
  expectedMessage: 'ok',
  requestTemplate: {},
};

describe('extractMessage', () => {
  it('returns undefined for an empty body', () => {
    expect(extractMessage(undefined)).toBeUndefined();
    expect(extractMessage('')).toBeUndefined();
  });

  it('returns undefined when the body is not JSON', () => {
    expect(extractMessage('<html>')).toBeUndefined();
  });

  it('returns undefined when the JSON message is not a string', () => {
    expect(extractMessage(JSON.stringify({ message: ['a', 'b'] }))).toBeUndefined();
  });
});

describe('TestScenarioService.run — transport and redaction edge cases', () => {
  let repo: { findById: jest.Mock; createRun: jest.Mock };
  let service: TestScenarioService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    repo = { findById: jest.fn().mockResolvedValue(scenario), createRun: jest.fn((d) => d) };
    service = new TestScenarioService(
      repo as unknown as TestScenarioRepository,
      { tokenFor: jest.fn() } as unknown as TestAuthService,
      { valueFor: jest.fn() } as unknown as TestFixtureService,
    );
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('redacts secrets nested inside arrays of the response body', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ message: 'ok', sessions: [{ accessToken: 'secret-1' }] }),
    });

    const run = await service.run('s1', {});

    expect(run.responseBody).not.toContain('secret-1');
    expect(run.responseBody).toContain('[REDACTED]');
  });

  it('records the transport error text when fetch rejects with a non-Error value', async () => {
    fetchMock.mockRejectedValue('socket hang up');

    const run = await service.run('s1', {});

    expect(run).toMatchObject({ actualStatus: null, passed: false, errorMessage: 'socket hang up' });
  });

  it('still records the status when reading the body fails', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      text: () => Promise.reject(new Error('stream reset')),
    });

    const run = await service.run('s1', {});

    expect(run).toMatchObject({ actualStatus: 200 });
  });

  it('logs the raw value when a background run fails with a non-Error', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    repo.createRun.mockRejectedValueOnce('disk full');
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{"message":"ok"}' });

    await service.run('s1', {}, { wait: false });
    await new Promise((r) => setImmediate(r));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    warn.mockRestore();
  });

  it('records a setup failure when the setup step throws a non-Error value', async () => {
    const auth = { tokenFor: jest.fn().mockRejectedValue('login down') };
    const withToken = new TestScenarioService(
      { ...repo, findById: jest.fn().mockResolvedValue({ ...scenario, requestTemplate: { headers: { authorization: 'Bearer {{token.tutor}}' } } }) } as unknown as TestScenarioRepository,
      auth as unknown as TestAuthService,
      { valueFor: jest.fn() } as unknown as TestFixtureService,
    );

    const run = await withToken.run('s1', {});

    expect(run).toMatchObject({ actualStatus: null, errorMessage: 'Setup failed: login down' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
