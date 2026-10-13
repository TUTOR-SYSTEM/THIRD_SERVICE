import { z } from 'zod';

export const testScenarioCategorySchema = z.enum([
  'valid',
  'auth',
  'validation',
  'not_found',
  'domain',
]);

export const testAuthProfileSchema = z.enum([
  'caller',
  'admin',
  'tutor',
  'student',
  'parent',
  'none',
]);

/** Request fired at the gateway. Path, header values and body strings may contain `{{variables}}`
 * (`{{accessToken}}`, `{{token.<role>}}`, `{{fixture.<key>}}`, `{{uuid}}`, …). */
export const requestTemplateSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

const scenarioFields = {
  service: z.string().min(1).max(50),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  // Relative to the gateway only — never an absolute/protocol-relative URL.
  path: z
    .string()
    .min(1)
    .refine((p) => p.startsWith('/') && !p.startsWith('//'), 'path must start with a single "/"'),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  requestTemplate: requestTemplateSchema.default({}),
  expectedStatus: z.number().int().min(100).max(599),
  // Substring of the response `message` (case-insensitive). A case passes only when both the status and this text match.
  expectedMessage: z.string().trim().min(1).max(500).nullable().optional(),
  category: testScenarioCategorySchema.default('valid'),
  authProfile: testAuthProfileSchema.default('caller'),
};

export const createTestScenarioSchema = z.object(scenarioFields);
// No defaults on update: an omitted field must stay untouched, not be reset to its default.
export const updateTestScenarioSchema = z
  .object({
    ...scenarioFields,
    requestTemplate: requestTemplateSchema,
    category: testScenarioCategorySchema,
    authProfile: testAuthProfileSchema,
  })
  .partial();

export const getTestScenariosQuerySchema = z.object({
  service: z.string().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  category: testScenarioCategorySchema.optional(),
});

/** How a fixture value is fetched: a GET through the gateway, then a dot path into the JSON body
 * (`data.classes.0.id` — numeric segments index arrays). */
export const fixtureResolverSchema = z.object({
  method: z.literal('GET').default('GET'),
  path: z
    .string()
    .min(1)
    .refine((p) => p.startsWith('/') && !p.startsWith('//'), 'path must start with a single "/"'),
  authProfile: testAuthProfileSchema.default('admin'),
  extract: z.string().min(1).max(200),
});

const fixtureFields = {
  key: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/, 'key: letters, digits and _, starting with a letter'),
  description: z.string().max(500).optional(),
  value: z.string().max(2000).nullable().optional(),
  resolver: fixtureResolverSchema.nullable().optional(),
};

export const createTestFixtureSchema = z
  .object(fixtureFields)
  .refine((f) => f.value != null || f.resolver != null, 'a fixture needs a value or a resolver');
export const updateTestFixtureSchema = z.object(fixtureFields).partial();

/**
 * One gateway route as `listHttpRoutes` describes it (`RouteInfoDto`). Every field the generator
 * reads must be declared here: `ZodValidationPipe` returns the parsed value, so undeclared keys
 * are stripped and the generator would see `undefined` (e.g. `uuidParams`). Optional-on-input
 * fields get defaults so the parsed type matches `RouteInfoDto` exactly.
 */
const routeInfoSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  summary: z.string().nullable().default(null),
  tag: z.string().nullable().default(null),
  params: z.array(z.string()).default([]),
  uuidParams: z.array(z.string()).default([]),
  isPublic: z.boolean().default(false),
  roles: z.array(z.string()).nullable().default(null),
  bodySchema: z.record(z.string(), z.unknown()).nullable().default(null),
  querySchema: z.record(z.string(), z.unknown()).nullable().default(null),
  multipart: z.boolean().default(false),
  oauth: z.boolean().default(false),
});

/**
 * `testscenario.generate` payload (RPC only, from the gateway): which routes (default: none
 * given → empty), the full route list used to look up fixture resolvers, and the case kinds.
 */
export const generateTestScenariosSchema = z.object({
  routes: z.array(routeInfoSchema).max(500).optional(),
  listRoutes: z.array(routeInfoSchema).max(5000).optional(),
  categories: z.array(testScenarioCategorySchema).min(1).optional(),
});

/** `POST /test-scenarios/bulk`: save many cases at once (duplicates are skipped). */
export const bulkCreateTestScenariosSchema = z.object({
  scenarios: z.array(createTestScenarioSchema).min(1).max(500),
});

/** RPC payload wrappers (`testscenario.update|delete|runs|run|fixtures.*`). */
const idSchema = z.string().min(1);
export const idPayloadSchema = z.object({ id: idSchema });
export const updateTestScenarioPayloadSchema = z.object({
  id: idSchema,
  dto: updateTestScenarioSchema,
});
export const updateTestFixturePayloadSchema = z.object({
  id: idSchema,
  dto: updateTestFixtureSchema,
});
export const runsPayloadSchema = z.object({
  id: idSchema,
  limit: z.number().int().min(1).max(100).optional(),
});
export const runTestScenarioPayloadSchema = z.object({
  id: idSchema,
  userId: z.string().optional(),
  accessToken: z.string().optional(),
  wait: z.boolean().optional(),
});
export const resolveFixturePayloadSchema = z.object({
  id: idSchema,
  accessToken: z.string().optional(),
});
