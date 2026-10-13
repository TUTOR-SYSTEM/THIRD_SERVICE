import { generateTestScenariosSchema } from '../../../src/packages/entities/test-scenario/test-scenario.schema';

/**
 * Regression for TRD3-07: the RPC pipe returns the parsed value, so every field the generator
 * reads (uuidParams, isPublic, roles, ...) must survive parsing instead of being stripped.
 */
describe('generateTestScenariosSchema keeps RouteInfo fields (TRD3-07)', () => {
  const route = {
    method: 'GET',
    path: '/classes/:id',
    summary: 'one class',
    tag: 'Classes',
    params: ['id'],
    uuidParams: ['id'],
    isPublic: false,
    roles: ['ADMIN'],
    bodySchema: null,
    querySchema: null,
    multipart: false,
    oauth: false,
  };

  it('preserves uuidParams and the other generator inputs', () => {
    const parsed = generateTestScenariosSchema.parse({ routes: [route], listRoutes: [] });
    expect(parsed.routes?.[0]).toEqual(route);
  });

  it('accepts a minimal route and fills the generator defaults', () => {
    const parsed = generateTestScenariosSchema.parse({
      routes: [{ method: 'POST', path: '/x' }],
    });
    expect(parsed.routes?.[0]).toEqual({
      method: 'POST',
      path: '/x',
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
    });
  });

  it('keeps listRoutes (fixture resolver lookup) instead of dropping it', () => {
    const parsed = generateTestScenariosSchema.parse({ routes: [], listRoutes: [route] });
    expect(parsed.listRoutes).toHaveLength(1);
  });

  it('still rejects a route with no method or path', () => {
    expect(() => generateTestScenariosSchema.parse({ routes: [{ method: 'GET' }] })).toThrow();
  });
});
