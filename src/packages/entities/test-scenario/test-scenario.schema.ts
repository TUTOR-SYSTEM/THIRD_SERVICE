import { z } from 'zod';

export const testScenarioCategorySchema = z.enum([
  'valid',
  'auth',
  'validation',
  'not_found',
  'domain',
]);

/** Request fired at the gateway. Header values may contain `{{accessToken}}`. */
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
  category: testScenarioCategorySchema.default('valid'),
};

export const createTestScenarioSchema = z.object(scenarioFields);
export const updateTestScenarioSchema = z.object(scenarioFields).partial();

export const getTestScenariosQuerySchema = z.object({
  service: z.string().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  category: testScenarioCategorySchema.optional(),
});
