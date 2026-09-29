import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { TestScenarioRpcController } from '../src/features/test-scenario/test-scenario.rpc.controller';
import { TestScenarioService } from '../src/features/test-scenario/test-scenario.service';
import { TestScenarioRepository } from '../src/features/test-scenario/test-scenario.repository';

/**
 * Drives `testscenario.run` end to end: real controller + service, a real HTTP server standing in
 * for the gateway (so the actual `fetch`, headers and correlation id go over the wire), and an
 * in-memory repository instead of Postgres.
 */
describe('testscenario.run (e2e)', () => {
  let gateway: Server;
  const received: {
    method?: string;
    url?: string;
    headers: IncomingMessage['headers'];
    body: string;
  }[] = [];

  const scenarios = new Map<string, Record<string, unknown>>();
  const runs: Record<string, unknown>[] = [];
  const repo = {
    findById: async (id: string) => scenarios.get(id) ?? null,
    createRun: async (data: Record<string, unknown>) => {
      const row = { id: `run-${runs.length + 1}`, ...data };
      runs.push(row);
      return row;
    },
  };

  let controller: TestScenarioRpcController;
  const run = (payload: Parameters<TestScenarioRpcController['run']>[0]) =>
    controller.run(payload) as Promise<Record<string, unknown>>;

  beforeAll(async () => {
    // Fake gateway: 401 without an Authorization header, 422 on an empty JSON body, else 200.
    gateway = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, headers: req.headers, body });
        const status = !req.headers.authorization ? 401 : body === '{}' ? 422 : 200;
        res.writeHead(status, { 'content-type': 'application/json' }).end('{}');
      });
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;

    const moduleRef = await Test.createTestingModule({
      controllers: [TestScenarioRpcController],
      providers: [TestScenarioService, { provide: TestScenarioRepository, useValue: repo }],
    }).compile();
    controller = moduleRef.get(TestScenarioRpcController);
  });

  afterAll(async () => {
    delete process.env.GATEWAY_BASE_URL;
    await new Promise((resolve) => gateway.close(resolve));
  });

  beforeEach(() => {
    received.length = 0;
    runs.length = 0;
    scenarios.clear();
    const authed = { authorization: 'Bearer {{accessToken}}' };
    scenarios.set('me-ok', {
      id: 'me-ok',
      method: 'GET',
      path: '/users/detail-user',
      expectedStatus: 200,
      requestTemplate: { headers: authed },
    });
    scenarios.set('me-no-token', {
      id: 'me-no-token',
      method: 'GET',
      path: '/users/detail-user',
      expectedStatus: 401,
      requestTemplate: { headers: authed },
    });
    scenarios.set('create-empty', {
      id: 'create-empty',
      method: 'POST',
      path: '/classes',
      expectedStatus: 422,
      requestTemplate: { headers: authed, body: {} },
    });
  });

  it('is exposed as the `testscenario.run` message pattern', () => {
    expect(Reflect.getMetadata(PATTERN_METADATA, TestScenarioRpcController.prototype.run)).toEqual(
      ['testscenario.run'],
    );
  });

  it('fires the request at the gateway with the caller token and a fresh x-correlation-id, then records a passing run', async () => {
    const result = await run({ id: 'me-ok', userId: 'admin-1', accessToken: 'tok' });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'GET', url: '/users/detail-user' });
    expect(received[0].headers.authorization).toBe('Bearer tok');
    expect(received[0].headers['x-correlation-id']).toBe(result.correlationId);
    expect(result).toMatchObject({
      actualStatus: 200,
      expectedStatus: 200,
      passed: true,
      triggeredBy: 'admin-1',
    });
    expect(runs).toHaveLength(1);
  });

  it('passes a "missing token" case because the token header is dropped, and fails a wrong expectation', async () => {
    const noToken = await run({ id: 'me-no-token' });
    expect(received[0].headers.authorization).toBeUndefined();
    expect(noToken).toMatchObject({ actualStatus: 401, passed: true });

    const wrong = await run({ id: 'me-no-token', accessToken: 'tok' });
    expect(wrong).toMatchObject({ actualStatus: 200, expectedStatus: 401, passed: false });
  });

  it('sends a JSON body for write methods', async () => {
    const result = await run({ id: 'create-empty', accessToken: 'tok' });
    expect(received[0]).toMatchObject({ method: 'POST', body: '{}' });
    expect(received[0].headers['content-type']).toBe('application/json');
    expect(result).toMatchObject({ actualStatus: 422, passed: true });
  });

  it('async mode answers with the correlation id first; the run is recorded once the gateway replied', async () => {
    const out = await run({ id: 'me-ok', accessToken: 'tok', wait: false });
    expect(out).toEqual({ correlationId: expect.any(String), scenarioId: 'me-ok' });

    await new Promise((r) => setTimeout(r, 200));
    expect(received[0].headers['x-correlation-id']).toBe(out.correlationId);
    expect(runs).toEqual([
      expect.objectContaining({ correlationId: out.correlationId, passed: true }),
    ]);
  });

  it('records a failed run (no status) when the gateway is unreachable', async () => {
    const saved = process.env.GATEWAY_BASE_URL;
    process.env.GATEWAY_BASE_URL = 'http://127.0.0.1:1';
    try {
      const result = await run({ id: 'me-ok', accessToken: 'tok' });
      expect(result).toMatchObject({ actualStatus: null, passed: false });
      expect(result.errorMessage).toEqual(expect.any(String));
    } finally {
      process.env.GATEWAY_BASE_URL = saved;
    }
  });

  it('rejects an unknown scenario', async () => {
    await expect(run({ id: 'nope' })).rejects.toThrow();
  });
});
