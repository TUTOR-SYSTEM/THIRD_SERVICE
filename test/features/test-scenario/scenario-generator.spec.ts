import type { RouteInfoDto } from '@packages/entities/test-scenario';
import {
  fixtureKeyFor,
  generateForRoute,
  sampleFromSchema,
  serviceForPath,
  suggestFixtures,
  wrongValueFor,
} from 'src/features/test-scenario/scenario-generator';

const route = (over: Partial<RouteInfoDto>): RouteInfoDto => ({
  method: 'GET',
  path: '/classes',
  summary: null,
  tag: null,
  params: [],
  uuidParams: [],
  isPublic: false,
  roles: null,
  bodySchema: null,
  querySchema: null,
  multipart: false,
  oauth: false,
  ...over,
});

const names = (cases: { name: string; expectedStatus: number }[]) =>
  cases.map((c) => `${c.name} → ${c.expectedStatus}`);

describe('scenario-generator', () => {
  it('derives fixture keys and owning services from the path', () => {
    expect(fixtureKeyFor('/classes/:id', 'id')).toBe('classId');
    expect(fixtureKeyFor('/class-sessions/:id/files', 'id')).toBe('classSessionId');
    expect(fixtureKeyFor('/categories/:id', 'id')).toBe('categoryId');
    expect(fixtureKeyFor('/classes/:id/students/:studentId', 'studentId')).toBe('studentId');
    expect(serviceForPath('/auth/login')).toBe('user-service');
    expect(serviceForPath('/notifications')).toBe('third-service');
    expect(serviceForPath('/classes/x')).toBe('tutor-service');
  });

  it('builds a GET detail route matrix: valid via fixture, auth, bad uuid, not found', () => {
    const cases = generateForRoute(route({ path: '/classes/:id', params: ['id'], uuidParams: ['id'] }));
    expect(names(cases)).toEqual([
      'Request hợp lệ → 200',
      'Không có token → 401',
      'Token không hợp lệ → 401',
      ':id không phải UUID → 400',
      'UUID không tồn tại → 404',
    ]);
    expect(cases[0]).toMatchObject({
      path: '/classes/{{fixture.classId}}',
      routePath: '/classes/:id',
      authProfile: 'caller',
      service: 'tutor-service',
      category: 'valid',
    });
    expect(cases[1]).toMatchObject({ path: '/classes/{{unknownUuid}}', authProfile: 'none' });
    expect(cases[2].requestTemplate).toEqual({ headers: { authorization: 'Bearer invalid.token.value' } });
    expect(cases[3].path).toBe('/classes/not-a-uuid');
  });

  it('adds 403 cases for roles outside @Roles and runs allowed cases as an allowed role', () => {
    const cases = generateForRoute(route({ path: '/reports', roles: ['TUTOR'] }), ['valid', 'auth']);
    expect(names(cases)).toEqual([
      'Request hợp lệ → 200',
      'Không có token → 401',
      'Token không hợp lệ → 401',
      'Role ADMIN bị chặn → 403',
      'Role STUDENT bị chặn → 403',
      'Role PARENT bị chặn → 403',
    ]);
    expect(cases[0].authProfile).toBe('tutor');
    expect(cases.find((c) => c.name === 'Role STUDENT bị chặn')!.authProfile).toBe('student');
  });

  it('derives body validation cases from the Zod JSON schema', () => {
    const bodySchema = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 2 },
        size: { type: 'integer', minimum: 3 },
        status: { type: 'string', enum: ['OPEN', 'CLOSED'] },
        note: { type: 'string' },
      },
      required: ['email', 'name', 'size'],
    };
    const cases = generateForRoute(route({ method: 'POST', path: '/classes', bodySchema, isPublic: true }));

    expect(names(cases)).toEqual([
      'Body rỗng → 422',
      'Thiếu email → 422',
      'Thiếu name → 422',
      'Thiếu size → 422',
      'Sai kiểu email → 422',
      'Sai kiểu name → 422',
      'Sai kiểu size → 422',
      'Sai kiểu status → 422',
      'Sai kiểu note → 422',
    ]);
    const valid = { email: '{{random.email}}', name: 'test-{{random.string}}', size: 3 };
    expect(cases.find((c) => c.name === 'Thiếu email')!.requestTemplate).toEqual({
      body: { name: valid.name, size: 3 },
    });
    expect(cases.find((c) => c.name === 'Sai kiểu status')!.requestTemplate).toEqual({
      body: { ...valid, status: '__INVALID__' },
    });
  });

  it('derives query validation cases and skips oauth, and multipart only gets auth', () => {
    const querySchema = {
      type: 'object',
      properties: { page: { type: 'integer' }, search: { type: 'string' }, status: { enum: ['A'] } },
    };
    expect(names(generateForRoute(route({ querySchema }), ['validation']))).toEqual([
      'Query page sai → 422',
      'Query status sai → 422',
    ]);
    expect(generateForRoute(route({ path: '/auth/google', oauth: true, isPublic: true }))).toEqual([]);
    expect(
      names(generateForRoute(route({ method: 'POST', path: '/upload', multipart: true, bodySchema: { type: 'object' } }))),
    ).toEqual(['Không có token → 401', 'Token không hợp lệ → 401']);
  });

  it('samples values that respect constraints and picks wrong ones per type', () => {
    expect(sampleFromSchema({ anyOf: [{ type: 'null' }, { type: 'string', format: 'uuid' }] })).toBe('{{unknownUuid}}');
    expect(sampleFromSchema({ type: 'string', maxLength: 5, minLength: 3 })).toBe('xxx');
    expect(sampleFromSchema({ type: 'array', items: { type: 'number', exclusiveMinimum: 0 } })).toEqual([1]);
    expect(wrongValueFor({ type: 'string' })).toBe(12345);
    expect(wrongValueFor({})).toBeUndefined();
  });

  it('suggests fixture resolvers from the list route', () => {
    const routes = [
      route({ path: '/classes' }),
      route({ path: '/classes/:id', params: ['id'], uuidParams: ['id'] }),
      route({ path: '/orphans/:id', params: ['id'], uuidParams: ['id'] }),
    ];
    const proposals = routes.flatMap((r) => generateForRoute(r, ['valid']));
    expect(suggestFixtures(proposals, routes)).toEqual([
      {
        key: 'classId',
        suggestion: { method: 'GET', path: '/classes', authProfile: 'admin', extract: 'data.classes.0.id' },
      },
      { key: 'orphanId', suggestion: null },
    ]);
  });
});

describe('scenario-generator — helper case matrix', () => {
  describe('serviceForPath', () => {
    it.each([
      ['/auth/login', 'user-service'],
      ['/users/me', 'user-service'],
      ['/admin/stats', 'user-service'],
      ['/students', 'user-service'],
      ['/emails', 'third-service'],
      ['/email', 'third-service'],
      ['/notifications', 'third-service'],
      ['/upload', 'third-service'],
      ['/redis', 'third-service'],
      ['/logs', 'third-service'],
      ['/test-scenarios', 'third-service'],
      ['/classes/123', 'tutor-service'],
      ['/sessions', 'tutor-service'],
    ])('maps %s to %s', (path, service) => {
      expect(serviceForPath(path)).toBe(service);
    });

    it('falls back to gateway for the root path', () => {
      expect(serviceForPath('/')).toBe('gateway');
      expect(serviceForPath('')).toBe('gateway');
    });
  });

  describe('fixtureKeyFor', () => {
    it('keeps non-id params as they are', () => {
      expect(fixtureKeyFor('/students/:studentId', 'studentId')).toBe('studentId');
    });

    it('singularises the segment before :id (ies → y, sses → ss, s → "")', () => {
      expect(fixtureKeyFor('/categories/:id', 'id')).toBe('categoryId');
      expect(fixtureKeyFor('/addresses/:id', 'id')).toBe('addressId');
      expect(fixtureKeyFor('/classes/:id', 'id')).toBe('classId');
      expect(fixtureKeyFor('/address/:id', 'id')).toBe('addressId');
    });

    it('camel-cases kebab and snake segments', () => {
      expect(fixtureKeyFor('/class-sessions/:id', 'id')).toBe('classSessionId');
      expect(fixtureKeyFor('/lesson_plans/:id', 'id')).toBe('lessonPlanId');
    });

    it('uses plain "id" when there is no segment before :id', () => {
      expect(fixtureKeyFor('/:id', 'id')).toBe('id');
    });
  });

  describe('sampleFromSchema', () => {
    it('returns a const verbatim', () => {
      expect(sampleFromSchema({ const: 'ADMIN' })).toBe('ADMIN');
    });

    it('returns the first enum member', () => {
      expect(sampleFromSchema({ type: 'string', enum: ['a', 'b'] })).toBe('a');
    });

    it('ignores an empty enum and samples by type', () => {
      expect(sampleFromSchema({ type: 'boolean', enum: [] })).toBe(true);
    });

    it.each([
      [{ type: 'string', format: 'email' }, '{{random.email}}'],
      [{ type: 'string', format: 'uuid' }, '{{unknownUuid}}'],
      [{ type: 'string', format: 'date-time' }, '2030-01-01T08:00:00.000Z'],
      [{ type: 'string', format: 'date' }, '2030-01-01'],
      [{ type: 'string', format: 'uri' }, 'https://example.com'],
      [{ type: 'string', format: 'url' }, 'https://example.com'],
    ])('samples a valid %j string', (schema, expected) => {
      expect(sampleFromSchema(schema)).toBe(expected);
    });

    it('pads a string up to minLength when it is longer than the base 13 chars', () => {
      const out = sampleFromSchema({ type: 'string', minLength: 20 }) as string;
      expect(out.startsWith('test-{{random.string}}')).toBe(true);
      expect(out.endsWith('x'.repeat(7))).toBe(true);
    });

    it('shrinks to a short literal when maxLength is below the base length', () => {
      expect(sampleFromSchema({ type: 'string', maxLength: 5, minLength: 3 })).toBe('xxx');
      expect(sampleFromSchema({ type: 'string', maxLength: 0 })).toBe('x');
    });

    it('uses the base string when no bounds are given', () => {
      expect(sampleFromSchema({ type: 'string' })).toBe('test-{{random.string}}');
    });

    it('samples integers at ceil(minimum) and numbers at minimum', () => {
      expect(sampleFromSchema({ type: 'integer', minimum: 2.5 })).toBe(3);
      expect(sampleFromSchema({ type: 'number', minimum: 2.5 })).toBe(2.5);
    });

    it('samples just above exclusiveMinimum', () => {
      expect(sampleFromSchema({ type: 'integer', exclusiveMinimum: 4 })).toBe(5);
      expect(sampleFromSchema({ type: 'number', exclusiveMinimum: 4 })).toBe(5);
    });

    it('caps at maximum when the maximum is below 1', () => {
      expect(sampleFromSchema({ type: 'number', maximum: 0 })).toBe(0);
      expect(sampleFromSchema({ type: 'number', maximum: 10 })).toBe(1);
    });

    it('defaults numbers to 1 when unconstrained', () => {
      expect(sampleFromSchema({ type: 'integer' })).toBe(1);
    });

    it('builds an array with minItems (at least one) of valid items', () => {
      expect(sampleFromSchema({ type: 'array', items: { type: 'integer' }, minItems: 3 })).toEqual([1, 1, 1]);
      expect(sampleFromSchema({ type: 'array', items: { type: 'boolean' } })).toEqual([true]);
    });

    it('returns an empty array when the items schema is missing', () => {
      expect(sampleFromSchema({ type: 'array' })).toEqual([]);
    });

    it('includes only required properties of an object', () => {
      const out = sampleFromSchema({
        type: 'object',
        required: ['name', 'age'],
        properties: { name: { type: 'string', maxLength: 3 }, age: { type: 'integer', minimum: 18 }, nick: { type: 'string' } },
      });
      expect(out).toEqual({ name: 'x', age: 18 });
    });

    it('samples null and returns undefined for an unknown type', () => {
      expect(sampleFromSchema({ type: 'null' })).toBeNull();
      expect(sampleFromSchema({})).toBeUndefined();
    });

    it('picks the non-null branch of anyOf / oneOf', () => {
      expect(sampleFromSchema({ anyOf: [{ type: 'null' }, { type: 'integer', minimum: 7 }] })).toBe(7);
      expect(sampleFromSchema({ oneOf: [{ type: 'boolean' }, { type: 'null' }] })).toBe(true);
    });

    it('treats a nullable type array as its non-null member', () => {
      expect(sampleFromSchema({ type: ['null', 'integer'] })).toBe(1);
    });
  });

  describe('wrongValueFor', () => {
    it('returns the invalid sentinel for any enum', () => {
      expect(wrongValueFor({ type: 'string', enum: ['a'] })).toBe('__INVALID__');
    });

    it.each([
      [{ type: 'string', format: 'email' }, 'not-an-email'],
      [{ type: 'string', format: 'uuid' }, 'not-a-uuid'],
      [{ type: 'string', format: 'date-time' }, 'not-a-date'],
      [{ type: 'string', format: 'date' }, 'not-a-date'],
      [{ type: 'string' }, 12345],
      [{ type: 'integer' }, 'not-a-number'],
      [{ type: 'number' }, 'not-a-number'],
      [{ type: 'boolean' }, 'not-a-boolean'],
      [{ type: 'array' }, 'not-an-array'],
      [{ type: 'object' }, 'not-an-object'],
    ])('gives a wrong-typed value for %j', (schema, expected) => {
      expect(wrongValueFor(schema)).toBe(expected);
    });

    it('returns undefined when no value could be wrong (no type)', () => {
      expect(wrongValueFor({})).toBeUndefined();
    });

    it('looks inside anyOf to pick the wrong value', () => {
      expect(wrongValueFor({ anyOf: [{ type: 'null' }, { type: 'boolean' }] })).toBe('not-a-boolean');
    });
  });
});
