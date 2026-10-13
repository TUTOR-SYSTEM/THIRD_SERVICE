import type {
  CreateTestScenarioDto,
  FixtureResolverDto,
  RouteInfoDto,
  TestAuthProfile,
  TestScenarioCategory,
} from '@packages/entities/test-scenario';

type JsonSchema = Record<string, unknown>;
type Proposal = CreateTestScenarioDto & { routePath: string };

const ALL_CATEGORIES: TestScenarioCategory[] = ['valid', 'auth', 'validation', 'not_found'];
const ROLE_PROFILES: Record<string, TestAuthProfile> = {
  ADMIN: 'admin',
  TUTOR: 'tutor',
  STUDENT: 'student',
  PARENT: 'parent',
};
const WRITE_METHODS = ['POST', 'PUT', 'PATCH'];
/** Cap on "wrong type" cases per body/query so one big DTO doesn't drown the list. */
const MAX_TYPE_CASES = 10;
const INVALID_TOKEN = 'Bearer invalid.token.value';

/** First path segment → the service that owns it (mirrors gateway's `RMQ_PREFIX_ROUTES`). */
const SERVICE_BY_SEGMENT: Record<string, string> = {
  auth: 'user-service',
  users: 'user-service',
  admin: 'user-service',
  students: 'user-service',
  emails: 'third-service',
  email: 'third-service',
  notifications: 'third-service',
  upload: 'third-service',
  redis: 'third-service',
  logs: 'third-service',
  'test-scenarios': 'third-service',
};

export function serviceForPath(path: string): string {
  const first = path.split('/')[1] ?? '';
  return SERVICE_BY_SEGMENT[first] ?? (first ? 'tutor-service' : 'gateway');
}

function singular(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses') || word.endsWith('ches') || word.endsWith('shes'))
    return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const camel = (word: string) => word.replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());

/** Fixture key for a path param: `/classes/:id` → `classId`, `/x/:studentId` → `studentId`. */
export function fixtureKeyFor(path: string, param: string): string {
  if (param !== 'id') return param;
  const segments = path.split('/').filter(Boolean);
  const before = segments[segments.indexOf(':id') - 1];
  return before ? `${camel(singular(before))}Id` : 'id';
}

type ParamMode = 'fixture' | 'unknown';

function fillPath(route: RouteInfoDto, mode: ParamMode, invalidParam?: string): string {
  return route.path.replace(/:(\w+)/g, (_, param: string) => {
    if (param === invalidParam) return 'not-a-uuid';
    return mode === 'fixture'
      ? `{{fixture.${fixtureKeyFor(route.path, param)}}}`
      : '{{unknownUuid}}';
  });
}

// ─── Values from JSON Schema ─────────────────────────────────────────────────

function typeOf(schema: JsonSchema): string | undefined {
  const type = schema.type;
  if (Array.isArray(type)) return type.find((t) => t !== 'null') as string | undefined;
  return type as string | undefined;
}

function variantOf(schema: JsonSchema): JsonSchema {
  const options = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
  return options?.find((o) => o.type !== 'null') ?? schema;
}

function sampleString(schema: JsonSchema): string {
  switch (schema.format) {
    case 'email':
      return '{{random.email}}';
    case 'uuid':
      return '{{unknownUuid}}';
    case 'date-time':
      return '2030-01-01T08:00:00.000Z';
    case 'date':
      return '2030-01-01';
    case 'uri':
    case 'url':
      return 'https://example.com';
  }
  const min = typeof schema.minLength === 'number' ? schema.minLength : 1;
  const max = typeof schema.maxLength === 'number' ? schema.maxLength : Infinity;
  const base = 'test-{{random.string}}'; // 13 characters once rendered
  if (max < 13) return 'x'.repeat(Math.max(min, 1));
  return min > 13 ? `${base}${'x'.repeat(min - 13)}` : base;
}

function sampleNumber(schema: JsonSchema): number {
  if (typeof schema.minimum === 'number') return schema.minimum;
  if (typeof schema.exclusiveMinimum === 'number') return schema.exclusiveMinimum + 1;
  if (typeof schema.maximum === 'number') return Math.min(1, schema.maximum);
  return 1;
}

/** A value that satisfies `schema`; objects get their required properties only (the safest
 * "valid" body). `undefined` when nothing sensible can be produced. */
export function sampleFromSchema(raw: JsonSchema): unknown {
  const schema = variantOf(raw);
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  switch (typeOf(schema)) {
    case 'string':
      return sampleString(schema);
    case 'integer':
      return Math.ceil(sampleNumber(schema));
    case 'number':
      return sampleNumber(schema);
    case 'boolean':
      return true;
    case 'array': {
      const items = schema.items as JsonSchema | undefined;
      const count = typeof schema.minItems === 'number' ? Math.max(schema.minItems, 1) : 1;
      return items ? Array.from({ length: count }, () => sampleFromSchema(items)) : [];
    }
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      const required = (schema.required ?? []) as string[];
      return Object.fromEntries(
        required.map((key) => [key, sampleFromSchema(properties[key] ?? {})]),
      );
    }
    case 'null':
      return null;
    default:
      return undefined;
  }
}

/** A value of the wrong type/format for `schema`, or `undefined` if any value would pass. */
export function wrongValueFor(raw: JsonSchema): unknown {
  const schema = variantOf(raw);
  if (Array.isArray(schema.enum)) return '__INVALID__';
  switch (typeOf(schema)) {
    case 'string':
      if (schema.format === 'email') return 'not-an-email';
      if (schema.format === 'uuid') return 'not-a-uuid';
      if (schema.format === 'date-time' || schema.format === 'date') return 'not-a-date';
      return 12345;
    case 'integer':
    case 'number':
      return 'not-a-number';
    case 'boolean':
      return 'not-a-boolean';
    case 'array':
      return 'not-an-array';
    case 'object':
      return 'not-an-object';
    default:
      return undefined;
  }
}

/** Query-string form of a wrong value — only types where a string can actually be wrong. */
function wrongQueryValueFor(raw: JsonSchema): string | undefined {
  const schema = variantOf(raw);
  if (Array.isArray(schema.enum)) return '__INVALID__';
  const type = typeOf(schema);
  if (type === 'integer' || type === 'number') return 'not-a-number';
  if (type === 'boolean') return 'not-a-boolean';
  if (schema.format === 'uuid') return 'not-a-uuid';
  if (schema.format === 'email') return 'not-an-email';
  return undefined;
}

// ─── Cases ───────────────────────────────────────────────────────────────────

/** The profile a "should work" request runs as: the admin caller unless the route excludes admins. */
function allowedProfile(route: RouteInfoDto): TestAuthProfile {
  if (!route.roles || route.roles.includes('ADMIN')) return 'caller';
  return ROLE_PROFILES[route.roles[0]] ?? 'caller';
}

/**
 * Proposes the standard failure/success matrix for one route from its introspected metadata:
 * - valid: a GET with every path param taken from a fixture (writes need real data — hand-written);
 * - auth: no token / invalid token (401) unless `@Public`, and every role outside `@Roles` (403);
 * - validation: non-UUID `ParseUUIDPipe` params (400), empty body / each missing required field /
 *   each wrongly-typed field (422) from the body's Zod schema, wrongly-typed query fields (422);
 * - not_found: an unknown UUID for every UUID param (404).
 * OAuth redirect routes get nothing; multipart uploads only get the auth cases.
 */
export function generateForRoute(
  route: RouteInfoDto,
  categories: TestScenarioCategory[] = ALL_CATEGORIES,
): Proposal[] {
  if (route.oauth) return [];
  const want = new Set(categories);
  const method = route.method as CreateTestScenarioDto['method'];
  const isWrite = WRITE_METHODS.includes(route.method);
  const bodySchema = route.multipart ? null : route.bodySchema;
  const validBody = isWrite && bodySchema ? sampleFromSchema(bodySchema) : undefined;
  const writeBody = isWrite ? (validBody ?? {}) : undefined;
  const profile = allowedProfile(route);
  const base = { service: serviceForPath(route.path), method, routePath: route.path };
  const out: Proposal[] = [];
  const add = (
    category: TestScenarioCategory,
    name: string,
    expectedStatus: number,
    path: string,
    extra: Partial<CreateTestScenarioDto> = {},
  ) =>
    out.push({
      ...base,
      category,
      name,
      expectedStatus,
      path,
      authProfile: profile,
      requestTemplate: writeBody === undefined ? {} : { body: writeBody },
      description: `Sinh tự động từ ${route.method} ${route.path}`,
      ...extra,
    });

  if (want.has('valid') && route.method === 'GET' && !route.multipart) {
    add('valid', 'Request hợp lệ', 200, fillPath(route, 'fixture'));
  }

  if (want.has('auth') && !route.isPublic) {
    // Guards run before pipes, so placeholder params/body never mask a 401/403.
    const path = fillPath(route, 'unknown');
    add('auth', 'Không có token', 401, path, { authProfile: 'none' });
    add('auth', 'Token không hợp lệ', 401, path, {
      authProfile: 'none',
      requestTemplate: {
        headers: { authorization: INVALID_TOKEN },
        ...(writeBody !== undefined ? { body: writeBody } : {}),
      },
    });
    if (route.roles) {
      for (const [role, roleProfile] of Object.entries(ROLE_PROFILES)) {
        if (!route.roles.includes(role)) {
          add('auth', `Role ${role} bị chặn`, 403, path, { authProfile: roleProfile });
        }
      }
    }
  }

  if (want.has('validation')) {
    for (const param of route.uuidParams) {
      add('validation', `:${param} không phải UUID`, 400, fillPath(route, 'unknown', param));
    }
    const path = fillPath(route, 'unknown');
    if (isWrite && bodySchema && validBody && typeof validBody === 'object') {
      const properties = (bodySchema.properties ?? {}) as Record<string, JsonSchema>;
      const required = (bodySchema.required ?? []) as string[];
      if (required.length > 0) {
        add('validation', 'Body rỗng', 422, path, { requestTemplate: { body: {} } });
      }
      const sample = validBody as Record<string, unknown>;
      for (const field of required) {
        const body = Object.fromEntries(Object.entries(sample).filter(([key]) => key !== field));
        add('validation', `Thiếu ${field}`, 422, path, { requestTemplate: { body } });
      }
      for (const [field, schema] of Object.entries(properties).slice(0, MAX_TYPE_CASES)) {
        const wrong = wrongValueFor(schema);
        if (wrong === undefined) continue;
        add('validation', `Sai kiểu ${field}`, 422, path, {
          requestTemplate: { body: { ...sample, [field]: wrong } },
        });
      }
    }
    if (route.querySchema) {
      const properties = (route.querySchema.properties ?? {}) as Record<string, JsonSchema>;
      for (const [field, schema] of Object.entries(properties).slice(0, MAX_TYPE_CASES)) {
        const wrong = wrongQueryValueFor(schema);
        if (wrong === undefined) continue;
        add(
          'validation',
          `Query ${field} sai`,
          422,
          `${path}?${field}=${encodeURIComponent(wrong)}`,
        );
      }
    }
  }

  if (want.has('not_found') && route.uuidParams.length > 0 && !route.multipart) {
    add('not_found', 'UUID không tồn tại', 404, fillPath(route, 'unknown'));
  }

  return out;
}

/** Fixture keys referenced by the proposals, each with a resolver guessed from the list route
 * (`/classes/:id` → `GET /classes`, `data.classes.0.id`) when one exists. */
export function suggestFixtures(
  proposals: Proposal[],
  routes: RouteInfoDto[],
): { key: string; suggestion: FixtureResolverDto | null }[] {
  const keys = new Map<string, string>();
  for (const proposal of proposals) {
    for (const match of proposal.path.matchAll(/\{\{fixture\.(\w+)\}\}/g)) {
      if (!keys.has(match[1])) keys.set(match[1], proposal.routePath);
    }
  }
  const getPaths = new Set(routes.filter((r) => r.method === 'GET').map((r) => r.path));

  return [...keys].map(([key, routePath]) => {
    const segments = routePath.split('/');
    const param = segments.findIndex(
      (s) => s.startsWith(':') && fixtureKeyFor(routePath, s.slice(1)) === key,
    );
    const listPath = param > 0 ? segments.slice(0, param).join('/') : null;
    const collection = listPath?.split('/').pop();
    const suggestion: FixtureResolverDto | null =
      listPath && collection && getPaths.has(listPath)
        ? {
            method: 'GET',
            path: listPath,
            authProfile: 'admin',
            extract: `data.${camel(collection)}.0.id`,
          }
        : null;
    return { key, suggestion };
  });
}
