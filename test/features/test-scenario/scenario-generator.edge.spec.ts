import type { RouteInfoDto } from '@packages/entities/test-scenario';
import {
  generateForRoute,
  sampleFromSchema,
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

describe('sampleFromSchema — shapes not covered by the main spec', () => {
  it('builds an array of minItems samples', () => {
    expect(sampleFromSchema({ type: 'array', items: { type: 'boolean' }, minItems: 3 })).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('returns an empty array when the array has no item schema', () => {
    expect(sampleFromSchema({ type: 'array' })).toEqual([]);
  });

  it('fills only the required properties of an object', () => {
    expect(
      sampleFromSchema({
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'integer', minimum: 5 } },
        required: ['age'],
      }),
    ).toEqual({ age: 5 });
  });

  it('samples null and returns undefined for an unknown type', () => {
    expect(sampleFromSchema({ type: 'null' })).toBeNull();
    expect(sampleFromSchema({ type: 'mystery' })).toBeUndefined();
  });

  it('samples a number from exclusiveMinimum and maximum bounds', () => {
    expect(sampleFromSchema({ type: 'number', exclusiveMinimum: 2 })).toBe(3);
    expect(sampleFromSchema({ type: 'number', maximum: 0 })).toBe(0);
  });
});

describe('wrongValueFor — each type branch', () => {
  it('uses the enum sentinel for enums', () => {
    expect(wrongValueFor({ enum: ['a', 'b'] })).toBe('__INVALID__');
  });

  it('breaks string formats specifically, and sends a number for plain strings', () => {
    expect(wrongValueFor({ type: 'string', format: 'email' })).toBe('not-an-email');
    expect(wrongValueFor({ type: 'string', format: 'uuid' })).toBe('not-a-uuid');
    expect(wrongValueFor({ type: 'string', format: 'date-time' })).toBe('not-a-date');
    expect(wrongValueFor({ type: 'string' })).toBe(12345);
  });

  it('breaks arrays, objects, numbers and booleans', () => {
    expect(wrongValueFor({ type: 'array' })).toBe('not-an-array');
    expect(wrongValueFor({ type: 'object' })).toBe('not-an-object');
    expect(wrongValueFor({ type: 'number' })).toBe('not-a-number');
    expect(wrongValueFor({ type: 'boolean' })).toBe('not-a-boolean');
  });

  it('returns undefined when no wrong value can be produced', () => {
    expect(wrongValueFor({})).toBeUndefined();
  });
});

describe('generateForRoute — validation and auth matrix', () => {
  const body = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      count: { type: 'integer' },
    },
    required: ['name', 'count'],
  };

  it('adds an empty-body case, a missing-field case per required field and wrong-type cases', () => {
    const cases = generateForRoute(
      route({ method: 'POST', path: '/classes', bodySchema: body as never }),
      ['validation'],
    );
    const names = cases.map((c) => c.name);

    expect(names).toEqual(
      expect.arrayContaining(['Body rỗng', 'Thiếu name', 'Thiếu count', 'Sai kiểu name', 'Sai kiểu email']),
    );
    expect(cases.every((c) => c.expectedStatus === 422)).toBe(true);
  });

  it('adds a non-UUID path case for each uuid param', () => {
    const cases = generateForRoute(
      route({ method: 'GET', path: '/classes/:id', uuidParams: ['id'] }),
      ['validation'],
    );
    expect(cases).toEqual([
      expect.objectContaining({ name: ':id không phải UUID', expectedStatus: 400 }),
    ]);
  });

  it('checks wrong query values for typed query fields', () => {
    const cases = generateForRoute(
      route({
        querySchema: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            active: { type: 'boolean' },
            owner: { type: 'string', format: 'uuid' },
            mail: { type: 'string', format: 'email' },
            kind: { enum: ['a'] },
            note: { type: 'string' },
          },
        } as never,
      }),
      ['validation'],
    );
    const paths = cases.map((c) => c.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        '/classes?page=not-a-number',
        '/classes?active=not-a-boolean',
        '/classes?owner=not-a-uuid',
        '/classes?mail=not-an-email',
        '/classes?kind=__INVALID__',
      ]),
    );
    expect(paths.some((p) => p.includes('note='))).toBe(false);
  });

  it('blocks every role outside @Roles and uses the first listed role as the allowed profile', () => {
    const cases = generateForRoute(route({ roles: ['TUTOR'] as never, path: '/x' }), ['auth']);
    const blocked = cases.filter((c) => c.name.startsWith('Role '));

    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((c) => c.name !== 'Role TUTOR bị chặn')).toBe(true);
    expect(cases.every((c) => c.authProfile !== undefined)).toBe(true);
  });

  it('runs the valid case as the caller when the route has no role restriction', () => {
    const [valid] = generateForRoute(route({ path: '/x' }), ['valid']);
    expect(valid.authProfile).toBe('caller');
  });

  it('skips the not-found case for multipart routes', () => {
    const cases = generateForRoute(
      route({ method: 'POST', path: '/files/:id', uuidParams: ['id'], multipart: true }),
      ['not_found'],
    );
    expect(cases).toEqual([]);
  });
});

describe('suggestFixtures — resolver guessing', () => {
  it('suggests no resolver when the fixture route has no list endpoint', () => {
    const proposals = generateForRoute(
      route({ method: 'GET', path: '/classes/:id', uuidParams: ['id'] }),
      ['valid'],
    );
    const [suggestion] = suggestFixtures(proposals, []);
    expect(suggestion.suggestion).toBeNull();
  });

  it('skips fixture keys that appear twice across proposals', () => {
    const proposals = [
      { path: '/a/{{fixture.x}}', routePath: '/a/:id' },
      { path: '/b/{{fixture.x}}', routePath: '/b/:id' },
    ] as never;
    expect(suggestFixtures(proposals, [])).toHaveLength(1);
  });
});

describe('scenario-generator — remaining optional-shape branches', () => {
  it('samples an array with items but no minItems as a single element', () => {
    expect(sampleFromSchema({ type: 'array', items: { type: 'string', maxLength: 5 } })).toHaveLength(1);
  });

  it('samples a required object key that has no declared property schema', () => {
    expect(sampleFromSchema({ type: 'object', required: ['ghost'] })).toEqual({ ghost: undefined });
  });

  it('falls back to the caller profile when the first role has no matching profile', () => {
    const [valid] = generateForRoute(route({ roles: ['GUEST'] as never, path: '/x' }), ['valid']);
    expect(valid.authProfile).toBe('caller');
  });

  it('generates no missing-field case and skips untyped properties in a body with no required list', () => {
    const cases = generateForRoute(
      route({
        method: 'POST',
        path: '/notes',
        bodySchema: { type: 'object', properties: { misc: {} } } as never,
      }),
      ['validation'],
    );
    expect(cases.map((c) => c.name)).not.toContain('Body rỗng');
    expect(cases.some((c) => c.name.startsWith('Sai kiểu misc'))).toBe(false);
  });

  it('handles a query schema with no properties map', () => {
    const cases = generateForRoute(
      route({ querySchema: { type: 'object' } as never, path: '/classes' }),
      ['validation'],
    );
    expect(cases).toEqual([]);
  });
});

describe('generateForRoute — body schema without a properties map', () => {
  it('produces no body-field cases for an object body that declares no properties', () => {
    const cases = generateForRoute(
      route({ method: 'POST', path: '/ping', bodySchema: { type: 'object' } as never }),
      ['validation'],
    );
    expect(cases).toEqual([]);
  });
});
