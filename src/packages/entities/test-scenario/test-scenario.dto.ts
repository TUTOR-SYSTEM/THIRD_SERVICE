import { z } from 'zod';
import {
  createTestScenarioSchema,
  getTestScenariosQuerySchema,
  updateTestScenarioSchema,
} from './test-scenario.schema';

export type CreateTestScenarioDto = z.infer<typeof createTestScenarioSchema>;
export type UpdateTestScenarioDto = z.infer<typeof updateTestScenarioSchema>;
export type GetTestScenariosQueryDto = z.infer<typeof getTestScenariosQuerySchema>;

/** One row of `testscenario.stats` — latest run per scenario, grouped by `(method, path)`. */
export type ScenarioStatsDto = {
  method: string;
  path: string;
  casesPassed: number;
  casesTotal: number;
};

/** One hop of a scenario's lastRun trace (`request_logs` row), in `createdAt` order. */
export type ScenarioFlowHopDto = {
  serviceName: string;
  type: 'HTTP' | 'RPC';
  statusCode: number | null;
  durationMs: number;
};
