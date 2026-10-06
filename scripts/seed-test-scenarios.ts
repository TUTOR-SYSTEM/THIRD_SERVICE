#!/usr/bin/env bun
/**
 * Seed `test_scenarios` for the key gateway endpoints (idempotent — a scenario is identified by
 * `method + path + name`, existing ones are left untouched).
 *
 * Usage: bun scripts/seed-test-scenarios.ts
 *
 * Part of the cases is generated: for each endpoint with a body we declare one valid body plus
 * its required fields (mirroring the Zod schema in `gateway/src/packages/entities/*`) and get a
 * "Thiếu field X" case per required field; `formatCases` adds domain-specific malformed values.
 * Validation failures are 422 (gateway `ZodValidationPipe`); wrong credentials are 400.
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/database/schema';
import { testScenarios } from '../src/database/schema';

type Category = 'valid' | 'auth' | 'validation' | 'not_found' | 'domain';
type Seed = {
  service: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  name: string;
  description?: string;
  requestTemplate: { headers?: Record<string, string>; body?: unknown };
  expectedStatus: number;
  category: Category;
};

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return databaseUrl;

  const host = process.env.POSTGRES_HOST?.trim() || 'localhost';
  const port = process.env.POSTGRES_PORT?.trim() || '5433';
  const db = process.env.POSTGRES_DB?.trim() || 'backends_db';
  const user = process.env.POSTGRES_USER?.trim() || 'postgres';
  const password = process.env.POSTGRES_PASSWORD?.trim() || 'postgres';

  const url = new URL(`postgres://${host}:${port}/${db}`);
  url.username = user;
  url.password = password;
  return url.toString();
}

const AUTHED = { authorization: 'Bearer {{accessToken}}' };
const BAD_TOKEN = { authorization: 'Bearer invalid.token.value' };
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

type Endpoint = Pick<Seed, 'service' | 'method' | 'path'> & { headers?: Record<string, string> };

/** "Thiếu field X" for every required field of a valid body. */
function missingFieldCases(
  ep: Endpoint,
  validBody: Record<string, unknown>,
  required: string[],
): Seed[] {
  return required.map((field) => {
    const { [field]: _omitted, ...body } = validBody;
    return {
      ...ep,
      name: `Thiếu ${field}`,
      requestTemplate: { headers: ep.headers, body },
      expectedStatus: 422,
      category: 'validation' as const,
    };
  });
}

function bodyCase(
  ep: Endpoint,
  name: string,
  body: unknown,
  expectedStatus: number,
  category: Category,
  description?: string,
): Seed {
  return {
    ...ep,
    name,
    description,
    requestTemplate: { headers: ep.headers, body },
    expectedStatus,
    category,
  };
}

function build(): Seed[] {
  const seeds: Seed[] = [];

  // ── POST /auth/login ────────────────────────────────────────────────────────
  const login: Endpoint = { service: 'user-service', method: 'POST', path: '/auth/login' };
  const loginBody = { email: 'dang04223@gmail.com', password: 'Admin@123456' };
  seeds.push(
    bodyCase(
      login,
      'Request hợp lệ',
      loginBody,
      200,
      'valid',
      'Tài khoản admin seed (scripts/seed-user.ts)',
    ),
    bodyCase(login, 'Sai mật khẩu', { ...loginBody, password: 'Wrong@123456' }, 400, 'domain'),
    bodyCase(
      login,
      'Email không tồn tại',
      { email: 'no-such-user@example.com', password: 'Admin@123456' },
      400,
      'not_found',
    ),
    bodyCase(
      login,
      'Email sai định dạng',
      { ...loginBody, email: 'not-an-email' },
      422,
      'validation',
    ),
    ...missingFieldCases(login, loginBody, ['email', 'password']),
  );

  // ── POST /auth/refresh ──────────────────────────────────────────────────────
  const refresh: Endpoint = { service: 'user-service', method: 'POST', path: '/auth/refresh' };
  seeds.push(
    bodyCase(
      refresh,
      'Refresh token không hợp lệ',
      { refreshToken: 'invalid.refresh.token' },
      401,
      'auth',
    ),
    bodyCase(refresh, 'Refresh token rỗng', { refreshToken: '' }, 422, 'validation'),
    ...missingFieldCases(refresh, { refreshToken: 'x' }, ['refreshToken']),
  );

  // ── GET /users/detail-user (current user) ───────────────────────────────────
  const me: Endpoint = { service: 'user-service', method: 'GET', path: '/users/detail-user' };
  seeds.push(
    {
      ...me,
      name: 'Request hợp lệ',
      requestTemplate: { headers: AUTHED },
      expectedStatus: 200,
      category: 'valid',
    },
    {
      ...me,
      name: 'Thiếu access token',
      requestTemplate: {},
      expectedStatus: 401,
      category: 'auth',
    },
    {
      ...me,
      name: 'Access token sai',
      requestTemplate: { headers: BAD_TOKEN },
      expectedStatus: 401,
      category: 'auth',
    },
  );

  // ── PUT /users (update own profile) ─────────────────────────────────────────
  const profile: Endpoint = {
    service: 'user-service',
    method: 'PUT',
    path: '/users',
    headers: AUTHED,
  };
  const profileBody = { firstName: 'Admin', lastName: 'Account', phone: '0901234567' };
  seeds.push(
    bodyCase(profile, 'Request hợp lệ', profileBody, 200, 'valid'),
    bodyCase({ ...profile, headers: undefined }, 'Thiếu access token', profileBody, 401, 'auth'),
    bodyCase({ ...profile, headers: BAD_TOKEN }, 'Access token sai', profileBody, 401, 'auth'),
    bodyCase(
      profile,
      'Body sai schema (email không hợp lệ)',
      { email: 'not-an-email' },
      422,
      'validation',
    ),
    bodyCase(profile, 'SĐT quá dài (>20 ký tự)', { phone: '0'.repeat(21) }, 422, 'domain'),
    bodyCase(profile, 'Tên quá ngắn (<2 ký tự)', { firstName: 'A' }, 422, 'domain'),
  );

  // ── GET /classes ────────────────────────────────────────────────────────────
  const classes: Endpoint = { service: 'tutor-service', method: 'GET', path: '/classes' };
  seeds.push(
    {
      ...classes,
      name: 'Request hợp lệ',
      requestTemplate: { headers: AUTHED },
      expectedStatus: 200,
      category: 'valid',
    },
    {
      ...classes,
      name: 'Thiếu access token',
      requestTemplate: {},
      expectedStatus: 401,
      category: 'auth',
    },
    {
      ...classes,
      name: 'Access token sai',
      requestTemplate: { headers: BAD_TOKEN },
      expectedStatus: 401,
      category: 'auth',
    },
    {
      ...classes,
      path: '/classes?page=0',
      name: 'Query sai schema (page=0)',
      requestTemplate: { headers: AUTHED },
      expectedStatus: 422,
      category: 'validation',
    },
    {
      ...classes,
      path: '/classes?status=UNKNOWN',
      name: 'Trạng thái lớp không hợp lệ',
      requestTemplate: { headers: AUTHED },
      expectedStatus: 422,
      category: 'domain',
    },
  );

  // ── POST /classes ───────────────────────────────────────────────────────────
  const createClass: Endpoint = {
    service: 'tutor-service',
    method: 'POST',
    path: '/classes',
    headers: AUTHED,
  };
  const classBody = {
    name: 'Lớp kiểm thử',
    code: 'TEST01',
    subject: 'Toán',
    startTime: '2030-01-01T00:00:00.000Z',
    endTime: '2030-06-01T00:00:00.000Z',
    tutorId: UNKNOWN_UUID,
  };
  seeds.push(
    bodyCase({ ...createClass, headers: undefined }, 'Thiếu access token', classBody, 401, 'auth'),
    bodyCase(
      createClass,
      'tutorId không phải UUID',
      { ...classBody, tutorId: 'abc' },
      422,
      'validation',
    ),
    bodyCase(
      createClass,
      'endTime sai định dạng ngày',
      { ...classBody, endTime: 'not-a-date' },
      422,
      'domain',
    ),
    bodyCase(createClass, 'Học phí âm', { ...classBody, tuition: -1 }, 422, 'domain'),
    ...missingFieldCases(createClass, classBody, ['name', 'subject', 'tutorId']),
  );

  // ── GET /classes/:id  &  GET /classes/:id/students ──────────────────────────
  for (const suffix of ['', '/students']) {
    const ep: Endpoint = {
      service: 'tutor-service',
      method: 'GET',
      path: `/classes/${UNKNOWN_UUID}${suffix}`,
      headers: AUTHED,
    };
    seeds.push(
      {
        ...ep,
        name: 'Lớp không tồn tại',
        requestTemplate: { headers: AUTHED },
        expectedStatus: 404,
        category: 'not_found',
      },
      {
        ...ep,
        name: 'Thiếu access token',
        requestTemplate: {},
        expectedStatus: 401,
        category: 'auth',
      },
      {
        ...ep,
        name: 'Access token sai',
        requestTemplate: { headers: BAD_TOKEN },
        expectedStatus: 401,
        category: 'auth',
      },
    );
  }

  // ── POST /classes/:id/students ──────────────────────────────────────────────
  const addStudents: Endpoint = {
    service: 'tutor-service',
    method: 'POST',
    path: `/classes/${UNKNOWN_UUID}/students`,
    headers: AUTHED,
  };
  seeds.push(
    bodyCase(
      { ...addStudents, headers: undefined },
      'Thiếu access token',
      { studentIds: [UNKNOWN_UUID] },
      401,
      'auth',
    ),
    bodyCase(addStudents, 'Danh sách học sinh rỗng', { studentIds: [] }, 422, 'validation'),
    bodyCase(addStudents, 'studentId không phải UUID', { studentIds: ['abc'] }, 422, 'validation'),
    bodyCase(addStudents, 'Lớp không tồn tại', { studentIds: [UNKNOWN_UUID] }, 404, 'not_found'),
    ...missingFieldCases(addStudents, { studentIds: [UNKNOWN_UUID] }, ['studentIds']),
  );

  return seeds;
}

async function main(): Promise<void> {
  const client = postgres(resolveDatabaseUrl());
  const db = drizzle(client, { schema });

  let created = 0;
  let skipped = 0;
  for (const seed of build()) {
    const [existing] = await db
      .select({ id: testScenarios.id })
      .from(testScenarios)
      .where(
        and(
          eq(testScenarios.method, seed.method),
          eq(testScenarios.path, seed.path),
          eq(testScenarios.name, seed.name),
        ),
      )
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }
    // Helpers spread `Endpoint` (which carries `headers`) into each seed — insert only real columns.
    const { service, method, path, name, description, requestTemplate, expectedStatus, category } =
      seed;
    await db.insert(testScenarios).values({
      service,
      method,
      path,
      name,
      description,
      requestTemplate,
      expectedStatus,
      category,
    });
    created++;
  }

  console.log(`test_scenarios: ${created} created, ${skipped} already present`);
  await client.end({ timeout: 5 });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
