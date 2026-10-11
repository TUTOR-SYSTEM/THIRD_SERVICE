import { z } from 'zod';
import {
  bulkCreateTestScenariosSchema,
  createTestFixtureSchema,
  createTestScenarioSchema,
  fixtureResolverSchema,
  generateTestScenariosSchema,
  testScenarioCategorySchema,
  getTestScenariosQuerySchema,
  testAuthProfileSchema,
  updateTestFixtureSchema,
  updateTestScenarioSchema,
} from './test-scenario.schema';

export type CreateTestScenarioDto = z.infer<typeof createTestScenarioSchema>;
export type UpdateTestScenarioDto = z.infer<typeof updateTestScenarioSchema>;
export type GetTestScenariosQueryDto = z.infer<typeof getTestScenariosQuerySchema>;
export type TestAuthProfile = z.infer<typeof testAuthProfileSchema>;
export type FixtureResolverDto = z.infer<typeof fixtureResolverSchema>;
export type GenerateTestScenariosBodyDto = z.infer<typeof generateTestScenariosSchema>;
export type BulkCreateTestScenariosDto = z.infer<typeof bulkCreateTestScenariosSchema>;
export type CreateTestFixtureDto = z.infer<typeof createTestFixtureSchema>;
export type UpdateTestFixtureDto = z.infer<typeof updateTestFixtureSchema>;

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

/** One row of `testscenario.authprofiles` — never carries the password. */
export type AuthProfileStatusDto = {
  profile: TestAuthProfile;
  /** `TEST_ACCOUNT_<ROLE>` is set. */
  configured: boolean;
  email: string | null;
};

/** One gateway route as `listHttpRoutes` (gateway) describes it — the generator's input. */
export type RouteInfoDto = {
  method: string;
  path: string;
  summary: string | null;
  tag: string | null;
  params: string[];
  uuidParams: string[];
  isPublic: boolean;
  roles: string[] | null;
  bodySchema: Record<string, unknown> | null;
  querySchema: Record<string, unknown> | null;
  multipart: boolean;
  oauth: boolean;
};

export type TestScenarioCategory = z.infer<typeof testScenarioCategorySchema>;

/** `testscenario.generate` payload: routes (already introspected by gateway) + categories wanted. */
export type GenerateScenariosDto = {
  routes: RouteInfoDto[];
  /** Parameterless GET routes of the whole gateway — where fixture resolvers are looked up. */
  listRoutes?: RouteInfoDto[];
  categories?: TestScenarioCategory[];
};

/** A proposed case; `exists` = a case with the same method + path + name is already saved. */
export type GeneratedScenarioDto = CreateTestScenarioDto & { routePath: string; exists: boolean };

/** A fixture the proposed cases reference, with a resolver guessed from the route list. */
export type FixtureSuggestionDto = {
  key: string;
  exists: boolean;
  suggestion: FixtureResolverDto | null;
};
