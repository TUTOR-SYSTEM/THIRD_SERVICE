import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ERROR_MESSAGES } from 'src/data/constants';
import type { InferSelectModel } from 'drizzle-orm';
import type { testScenarios } from '../../database/schema';
import type {
  CreateTestScenarioDto,
  GetTestScenariosQueryDto,
  UpdateTestScenarioDto,
} from '@packages/entities/test-scenario';
import { TestScenarioRepository } from './test-scenario.repository';

const RUN_TIMEOUT_MS = 15_000;
const ACCESS_TOKEN_PLACEHOLDER = '{{accessToken}}';

@Injectable()
export class TestScenarioService {
  private readonly logger = new Logger(TestScenarioService.name);
  constructor(private readonly repo: TestScenarioRepository) {}

  create(dto: CreateTestScenarioDto) {
    return this.repo.create(dto);
  }

  findAll(query: GetTestScenariosQueryDto) {
    return this.repo.findAll(query);
  }

  async update(id: string, dto: UpdateTestScenarioDto) {
    const row = await this.repo.update(id, dto);
    if (!row) throw new NotFoundException(ERROR_MESSAGES.TEST_SCENARIO_NOT_FOUND);
    return row;
  }

  async delete(id: string) {
    const row = await this.repo.delete(id);
    if (!row) throw new NotFoundException(ERROR_MESSAGES.TEST_SCENARIO_NOT_FOUND);
    return row;
  }

  stats() {
    return this.repo.statsByEndpoint();
  }

  /**
   * Fires the scenario's request at the real gateway with a fresh `x-correlation-id`, so it flows
   * through every service and is logged in `request_logs` like organic traffic; then records the
   * verdict in `test_runs`. Transport failures (timeout, connection refused) are a failed run,
   * not an exception.
   *
   * `wait: false` returns `{ correlationId }` immediately and finishes the run in the background —
   * the caller follows the trace live through the `log:new` socket and the run is still recorded.
   */
  async run(
    id: string,
    ctx: { userId?: string; accessToken?: string },
    opts: { wait?: boolean } = {},
  ) {
    const scenario = await this.repo.findById(id);
    if (!scenario) throw new NotFoundException(ERROR_MESSAGES.TEST_SCENARIO_NOT_FOUND);

    const correlationId = randomUUID();
    const execution = this.execute(scenario, ctx, correlationId);
    if (opts.wait === false) {
      execution.catch((err: unknown) =>
        this.logger.warn(
          `Background test run failed to record: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return { correlationId, scenarioId: scenario.id };
    }
    return execution;
  }

  private async execute(
    scenario: InferSelectModel<typeof testScenarios>,
    ctx: { userId?: string; accessToken?: string },
    correlationId: string,
  ) {
    const template = scenario.requestTemplate as {
      headers?: Record<string, string>;
      body?: unknown;
    };
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(template.headers ?? {})) {
      // A `{{accessToken}}` header is dropped when the caller has no token, which is exactly how
      // the "missing token" cases stay honest.
      if (value.includes(ACCESS_TOKEN_PLACEHOLDER) && !ctx.accessToken) continue;
      headers[key] = value.replaceAll(ACCESS_TOKEN_PLACEHOLDER, ctx.accessToken ?? '');
    }
    // Always carry the caller's token so replayed requests are authenticated even when the template
    // (e.g. one built from `request_logs`, which never stores headers) has no authorization header.
    // Auth-category cases test token handling itself (missing/invalid token) and stay untouched.
    const hasAuthHeader = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
    if (ctx.accessToken && !hasAuthHeader && scenario.category !== 'auth') {
      headers.authorization = `Bearer ${ctx.accessToken}`;
    }
    headers['x-correlation-id'] = correlationId;

    const hasBody = template.body !== undefined && !['GET', 'DELETE'].includes(scenario.method);
    if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }

    const baseUrl = (process.env.GATEWAY_BASE_URL ?? 'http://localhost:8888').replace(/\/+$/, '');
    const started = Date.now();
    let actualStatus: number | null = null;
    let errorMessage: string | undefined;
    try {
      const res = await fetch(`${baseUrl}${scenario.path}`, {
        method: scenario.method,
        headers,
        body: hasBody ? JSON.stringify(template.body) : undefined,
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      });
      actualStatus = res.status;
      await res.arrayBuffer().catch(() => undefined); // drain so the connection is released
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    const durationMs = Date.now() - started;

    return this.repo.createRun({
      scenarioId: scenario.id,
      correlationId,
      actualStatus,
      expectedStatus: scenario.expectedStatus,
      passed: actualStatus === scenario.expectedStatus,
      durationMs,
      errorMessage,
      triggeredBy: ctx.userId,
    });
  }
}
