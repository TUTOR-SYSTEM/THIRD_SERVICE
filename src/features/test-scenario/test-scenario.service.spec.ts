import { NotFoundException } from '@nestjs/common';
import { TestScenarioService } from './test-scenario.service';
import type { TestScenarioRepository } from './test-scenario.repository';

const scenario = {
  id: 's1',
  method: 'GET',
  path: '/users/me',
  expectedStatus: 401,
  requestTemplate: { headers: { authorization: 'Bearer {{accessToken}}' } },
};

describe('TestScenarioService.run', () => {
  let repo: { findById: jest.Mock; createRun: jest.Mock };
  let service: TestScenarioService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    repo = { findById: jest.fn().mockResolvedValue(scenario), createRun: jest.fn((d) => d) };
    service = new TestScenarioService(repo as unknown as TestScenarioRepository);
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('passes when the actual status equals the expected one and tags the correlation id', async () => {
    fetchMock.mockResolvedValue({ status: 401, arrayBuffer: async () => new ArrayBuffer(0) });
    const run = await service.run('s1', { userId: 'u1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/users\/me$/);
    expect(init.headers['x-correlation-id']).toBe(run.correlationId);
    expect(run).toMatchObject({ actualStatus: 401, passed: true, triggeredBy: 'u1' });
  });

  it('drops a {{accessToken}} header when the caller has no token', async () => {
    fetchMock.mockResolvedValue({ status: 401, arrayBuffer: async () => new ArrayBuffer(0) });
    await service.run('s1', {});
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it('substitutes the caller token into the header', async () => {
    fetchMock.mockResolvedValue({ status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
    const run = await service.run('s1', { accessToken: 'abc' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer abc');
    expect(run).toMatchObject({ passed: false });
  });

  it('adds the caller token when the template has no authorization header', async () => {
    repo.findById.mockResolvedValue({ ...scenario, category: 'valid', requestTemplate: {} });
    fetchMock.mockResolvedValue({ status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
    await service.run('s1', { accessToken: 'abc' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer abc');
  });

  it('leaves auth-category cases without a token header untouched', async () => {
    repo.findById.mockResolvedValue({ ...scenario, category: 'auth', requestTemplate: {} });
    fetchMock.mockResolvedValue({ status: 401, arrayBuffer: async () => new ArrayBuffer(0) });
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
        release = () => resolve({ status: 401, arrayBuffer: async () => new ArrayBuffer(0) });
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
});
