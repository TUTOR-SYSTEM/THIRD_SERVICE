import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ERROR_MESSAGES } from 'src/data/constants';
import type { InferSelectModel } from 'drizzle-orm';
import type { testScenarios } from '../../database/schema';
import type {
  CreateTestScenarioDto,
  FixtureSuggestionDto,
  GenerateScenariosDto,
  GeneratedScenarioDto,
  GetTestScenariosQueryDto,
  UpdateTestScenarioDto,
} from '@packages/entities/test-scenario';
import { testAuthProfileSchema } from '@packages/entities/test-scenario';
import { TestAuthService, ACCOUNT_PROFILES, type AccountProfile } from './test-auth.service';
import { buildGatewayUrl } from './gateway-url';
import { TestFixtureService } from './test-fixture.service';
import { TestScenarioRepository, scenarioKey } from './test-scenario.repository';
import { generateForRoute, suggestFixtures } from './scenario-generator';
import { builtinVariable, collectVariables, renderString, renderValue } from './test-template';

const RUN_TIMEOUT_MS = 15_000;
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const ACCESS_TOKEN_VARIABLE = 'accessToken';
const MAX_RESPONSE_BODY_LENGTH = 4000;
const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'oldPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        SENSITIVE_KEYS.includes(key) ? '[REDACTED]' : redact(val),
      ]),
    );
  }
  return value;
}

/** Response body as stored on a run: JSON gets its secrets redacted (login returns tokens), then
 * everything is capped so one huge list response can't bloat `test_runs`. */
/**
 * A case passes only when BOTH hold: the HTTP status equals `expectedStatus`, and the response's
 * JSON `message` contains `expectedMessage` (case-insensitive). A case without `expectedMessage`
 * fails on purpose, so an unverified message can never pass silently.
 */
export function judgeRun(
  scenario: { expectedStatus: number; expectedMessage: string | null },
  actualStatus: number | null,
  responseBody: string | undefined,
): { passed: boolean; errorMessage?: string } {
  if (actualStatus !== scenario.expectedStatus) {
    return { passed: false };
  }
  if (!scenario.expectedMessage) {
    return {
      passed: false,
      errorMessage: 'Thiếu expectedMessage: chưa có message chuẩn để so sánh',
    };
  }
  const actualMessage = extractMessage(responseBody);
  const want = scenario.expectedMessage.toLowerCase();
  if (actualMessage?.toLowerCase().includes(want)) {
    return { passed: true };
  }
  return {
    passed: false,
    errorMessage: `Sai message: mong đợi chứa "${scenario.expectedMessage}", nhận "${actualMessage ?? '(không có message)'}"`,
  };
}

/** The `message` field of the gateway envelope, read from the (already redacted) stored body. */
export function extractMessage(responseBody: string | undefined): string | undefined {
  if (!responseBody) return undefined;
  try {
    const parsed = JSON.parse(responseBody) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : undefined;
  } catch {
    return undefined;
  }
}

export function formatResponseBody(raw: string): string | undefined {
  if (!raw) return undefined;
  let text = raw;
  try {
    text = JSON.stringify(redact(JSON.parse(raw)));
  } catch {
    // Not JSON (HTML error page, plain text) — keep as is.
  }
  return text.length > MAX_RESPONSE_BODY_LENGTH
    ? `${text.slice(0, MAX_RESPONSE_BODY_LENGTH)}…(truncated)`
    : text;
}

@Injectable()
export class TestScenarioService {
  private readonly logger = new Logger(TestScenarioService.name);
  constructor(
    private readonly repo: TestScenarioRepository,
    private readonly auth: TestAuthService,
    private readonly fixtures: TestFixtureService,
  ) {}

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
   * Proposes the standard case matrix for the given routes (see `generateForRoute`) without saving
   * anything; each proposal says whether it already exists, and the fixtures the proposals use are
   * listed with a guessed resolver.
   */
  async generate(
    dto: GenerateScenariosDto,
  ): Promise<{ scenarios: GeneratedScenarioDto[]; fixtures: FixtureSuggestionDto[] }> {
    const routes = dto.routes ?? [];
    const proposals = routes.flatMap((route) => generateForRoute(route, dto.categories));
    const [existing, fixtures] = await Promise.all([
      this.repo.existingKeys(),
      this.fixtures.findAll(),
    ]);
    const fixtureKeys = new Set(fixtures.map((f) => f.key));
    return {
      scenarios: proposals.map((p) => ({ ...p, exists: existing.has(scenarioKey(p)) })),
      fixtures: suggestFixtures(proposals, [...routes, ...(dto.listRoutes ?? [])]).map((f) => ({
        ...f,
        exists: fixtureKeys.has(f.key),
      })),
    };
  }

  /** Saves many scenarios at once, skipping any whose method + path + name already exists (also
   * within the batch itself), so re-running the generator is harmless. */
  async createMany(scenarios: CreateTestScenarioDto[]) {
    const existing = await this.repo.existingKeys();
    const fresh = scenarios.filter((s) => {
      const key = scenarioKey(s);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    const created = await this.repo.createMany(fresh);
    return { created: created.length, skipped: scenarios.length - created.length };
  }

  /** Most recent runs of one scenario (newest first) — the case's run history. */
  async findRuns(id: string, limit = 20) {
    const scenario = await this.repo.findById(id);
    if (!scenario) throw new NotFoundException(ERROR_MESSAGES.TEST_SCENARIO_NOT_FOUND);
    return this.repo.findRuns(id, Math.min(Math.max(limit, 1), 100));
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

  /** F-15: write requests are blocked in production unless TEST_SCENARIO_ALLOW_WRITES=true. */
  private writeBlockedReason(method: string): string | undefined {
    if (!WRITE_METHODS.includes(method.toUpperCase())) return undefined;
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (process.env.TEST_SCENARIO_ALLOW_WRITES === 'true') return undefined;
    return `${method} requests are blocked in production; set TEST_SCENARIO_ALLOW_WRITES=true to allow write scenarios`;
  }

  private async execute(
    scenario: InferSelectModel<typeof testScenarios>,
    ctx: { userId?: string; accessToken?: string },
    correlationId: string,
  ) {
    const record = (
      result: {
        actualStatus: number | null;
        durationMs: number;
        errorMessage?: string;
        responseBody?: string;
        requestPath: string;
      },
      // The full body is judged, not the stored copy: a large payload can push the stored copy
      // past MAX_RESPONSE_BODY_LENGTH and cut the message off.
      rawBody?: string,
    ) => {
      const verdict = judgeRun(scenario, result.actualStatus, rawBody);
      return this.repo.createRun({
        scenarioId: scenario.id,
        correlationId,
        expectedStatus: scenario.expectedStatus,
        passed: verdict.passed,
        triggeredBy: ctx.userId,
        ...result,
        errorMessage: verdict.errorMessage ?? result.errorMessage,
      });
    };
    let request: Awaited<ReturnType<TestScenarioService['buildRequest']>>;
    try {
      request = await this.buildRequest(scenario, ctx.accessToken);
    } catch (err) {
      // Login, fixture or variable trouble: nothing was sent, so this is a failed run, not a crash.
      return record({
        actualStatus: null,
        durationMs: 0,
        errorMessage: `Setup failed: ${err instanceof Error ? err.message : String(err)}`,
        requestPath: scenario.path,
      });
    }
    request.headers['x-correlation-id'] = correlationId;

    const blocked = this.writeBlockedReason(scenario.method);
    let url: string | undefined;
    let urlError: string | undefined;
    try {
      url = buildGatewayUrl(request.path);
    } catch (err) {
      urlError = err instanceof Error ? err.message : String(err);
    }
    if (blocked || !url) {
      return record({
        actualStatus: null,
        durationMs: 0,
        errorMessage: `Setup failed: ${blocked ?? urlError}`,
        requestPath: request.path,
      });
    }
    const started = Date.now();
    let actualStatus: number | null = null;
    let errorMessage: string | undefined;
    let responseBody: string | undefined;
    let rawBody: string | undefined;
    try {
      const res = await fetch(url, {
        method: scenario.method,
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      });
      actualStatus = res.status;
      // A rejected token must not stay cached: the next run logs the account in again.
      if (
        res.status === 401 &&
        (ACCOUNT_PROFILES as readonly string[]).includes(scenario.authProfile ?? '')
      ) {
        this.auth.invalidate?.(scenario.authProfile as AccountProfile);
      }
      // Reading the body also drains it, so the connection is released.
      rawBody = await res.text().catch(() => '');
      responseBody = formatResponseBody(rawBody);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    return record(
      {
        actualStatus,
        durationMs: Date.now() - started,
        errorMessage,
        responseBody,
        requestPath: request.path,
      },
      rawBody,
    );
  }

  /**
   * Turns the stored template into the concrete request: picks the auth profile's token, fills
   * every `{{variable}}` in path, headers and body, and attaches the token when the template
   * didn't. Throws when a variable can't be filled (unknown name, fixture or login failure).
   */
  private async buildRequest(
    scenario: InferSelectModel<typeof testScenarios>,
    callerToken?: string,
  ) {
    const template = scenario.requestTemplate as {
      headers?: Record<string, string>;
      body?: unknown;
    };
    const profile = scenario.authProfile ?? 'caller';
    const profileToken = await this.auth.tokenFor(profile, callerToken);

    // Token variables may legitimately have no value (`none` profile, caller without a token): a
    // header using one is then dropped, which is exactly how "missing token" cases stay honest.
    const vars = new Map<string, string>();
    const emptyTokens = new Set<string>();
    for (const name of collectVariables(scenario.path, template.headers, template.body)) {
      const value = await this.variable(name, profileToken, callerToken);
      if (value === undefined) emptyTokens.add(name);
      else vars.set(name, value);
    }
    const usesEmptyToken = (text: string) => collectVariables(text).some((n) => emptyTokens.has(n));

    if (
      usesEmptyToken(scenario.path) ||
      collectVariables(template.body).some((n) => emptyTokens.has(n))
    ) {
      throw new Error(`a token variable has no value for auth profile "${profile}"`);
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(template.headers ?? {})) {
      if (usesEmptyToken(value)) continue;
      headers[renderString(key, vars)] = renderString(value, vars);
    }
    // Carry the profile's token when the template has no authorization header (templates built from
    // `request_logs` never store headers). Legacy `caller` + auth-category cases test token handling
    // itself (missing/invalid token) and stay untouched; an explicit role profile always sends its
    // token, so "student calls an admin route → 403" works without a header in the template.
    const hasAuthHeader = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
    const legacyAuthCase = profile === 'caller' && scenario.category === 'auth';
    if (profileToken && !hasAuthHeader && !legacyAuthCase) {
      headers.authorization = `Bearer ${profileToken}`;
    }

    const hasBody = template.body !== undefined && !['GET', 'DELETE'].includes(scenario.method);
    if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }

    return {
      path: renderString(scenario.path, vars),
      headers,
      body: hasBody ? JSON.stringify(renderValue(template.body, vars)) : undefined,
    };
  }

  /** One `{{name}}`: `undefined` only for a token that legitimately has no value. */
  private async variable(
    name: string,
    profileToken: string | undefined,
    callerToken: string | undefined,
  ): Promise<string | undefined> {
    if (name === ACCESS_TOKEN_VARIABLE) return profileToken;
    if (name.startsWith('token.')) {
      const profile = testAuthProfileSchema.safeParse(name.slice('token.'.length));
      if (!profile.success) throw new Error(`unknown auth profile in {{${name}}}`);
      return this.auth.tokenFor(profile.data, callerToken);
    }
    if (name.startsWith('fixture.'))
      return this.fixtures.valueFor(name.slice('fixture.'.length), callerToken);
    const builtin = builtinVariable(name);
    if (builtin === undefined) throw new Error(`unknown variable {{${name}}}`);
    return builtin;
  }
}
