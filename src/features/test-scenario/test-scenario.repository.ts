import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { testRuns, testScenarios } from '@tutor/gateway/schema';
import type {
  CreateTestScenarioDto,
  GetTestScenariosQueryDto,
  ScenarioStatsDto,
  UpdateTestScenarioDto,
} from '@packages/entities/test-scenario';

export type CreateTestRunData = {
  scenarioId: string;
  correlationId: string;
  actualStatus: number | null;
  expectedStatus: number;
  passed: boolean;
  durationMs: number;
  errorMessage?: string;
  triggeredBy?: string;
};

@Injectable()
export class TestScenarioRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async create(data: CreateTestScenarioDto) {
    const [row] = await this.db.insert(testScenarios).values(data).returning();
    return row;
  }

  async findAll(query: GetTestScenariosQueryDto) {
    const conditions: SQL[] = [];
    if (query.service) conditions.push(eq(testScenarios.service, query.service));
    if (query.method) conditions.push(eq(testScenarios.method, query.method.toUpperCase()));
    if (query.path) conditions.push(eq(testScenarios.path, query.path));
    if (query.category) conditions.push(eq(testScenarios.category, query.category));

    // Latest run per scenario rides along so the list can show its pass/fail badge.
    const latestRun = this.db
      .selectDistinctOn([testRuns.scenarioId], {
        scenarioId: testRuns.scenarioId,
        correlationId: testRuns.correlationId,
        actualStatus: testRuns.actualStatus,
        passed: testRuns.passed,
        durationMs: testRuns.durationMs,
        runAt: testRuns.createdAt,
      })
      .from(testRuns)
      .orderBy(testRuns.scenarioId, desc(testRuns.createdAt))
      .as('latest_run');

    const rows = await this.db
      .select({
        scenario: testScenarios,
        runId: latestRun.scenarioId,
        correlationId: latestRun.correlationId,
        actualStatus: latestRun.actualStatus,
        passed: latestRun.passed,
        durationMs: latestRun.durationMs,
        runAt: latestRun.runAt,
      })
      .from(testScenarios)
      .leftJoin(latestRun, eq(latestRun.scenarioId, testScenarios.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(testScenarios.path), asc(testScenarios.method), asc(testScenarios.createdAt));

    return rows.map(({ scenario, runId, ...run }) => ({
      ...scenario,
      lastRun: runId ? run : null,
    }));
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(testScenarios).where(eq(testScenarios.id, id));
    return row ?? null;
  }

  async update(id: string, data: UpdateTestScenarioDto) {
    const [row] = await this.db
      .update(testScenarios)
      .set(data)
      .where(eq(testScenarios.id, id))
      .returning();
    return row ?? null;
  }

  async delete(id: string) {
    const [row] = await this.db.delete(testScenarios).where(eq(testScenarios.id, id)).returning();
    return row ?? null;
  }

  async createRun(data: CreateTestRunData) {
    const [row] = await this.db.insert(testRuns).values(data).returning();
    return row;
  }

  /** casesPassed / casesTotal per `(method, path)` — a scenario counts as passed only if its
   * most recent run passed; a never-run scenario counts toward the total only. */
  async statsByEndpoint(): Promise<ScenarioStatsDto[]> {
    const latestRun = this.db
      .selectDistinctOn([testRuns.scenarioId], {
        scenarioId: testRuns.scenarioId,
        passed: testRuns.passed,
      })
      .from(testRuns)
      .orderBy(testRuns.scenarioId, desc(testRuns.createdAt))
      .as('latest_run');

    const rows = await this.db
      .select({
        method: testScenarios.method,
        path: testScenarios.path,
        casesTotal: sql<string>`count(*)`,
        casesPassed: sql<string>`count(*) filter (where ${latestRun.passed} = true)`,
      })
      .from(testScenarios)
      .leftJoin(latestRun, eq(latestRun.scenarioId, testScenarios.id))
      .groupBy(testScenarios.method, testScenarios.path);

    return rows.map((r) => ({
      method: r.method,
      path: r.path,
      casesTotal: Number(r.casesTotal),
      casesPassed: Number(r.casesPassed),
    }));
  }
}
