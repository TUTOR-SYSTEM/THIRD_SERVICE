#!/usr/bin/env bun
/**
 * Build `test_scenarios` from real traffic in `request_logs` (idempotent — a scenario is identified
 * by `method + path + name`, existing ones are left untouched).
 *
 * Usage: bun scripts/seed-test-scenarios-from-logs.ts [--limit=200]
 *
 * Only root HTTP hops logged at the gateway count. Rows are grouped by `(method, path, statusCode)`
 * and the most recent sample of each group becomes one scenario whose `expectedStatus` is the status
 * that was actually observed. The gateway logs redacted/truncated bodies, so a sample whose body
 * contains `[REDACTED]` or `…(truncated)` (e.g. login) is skipped — use `seed-test-scenarios.ts`
 * for those. Admin monitoring endpoints (`/logs`, `/test-scenarios`) are excluded so a run doesn't
 * feed on itself.
 */
import 'dotenv/config';
import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@tutor/gateway/schema';
import { requestLogs, testScenarios } from '@tutor/gateway/schema';

type Category = 'valid' | 'auth' | 'validation' | 'not_found' | 'domain';

const EXCLUDED_PREFIXES = ['/logs', '/test-scenarios', '/auth/refresh', '/health'];
const PUBLIC_PREFIXES = ['/auth/'];
const SAFE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

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

function categoryFor(status: number): Category {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 422) return 'validation';
  if (status >= 400) return 'domain';
  return 'valid';
}

/** Parsed body, `undefined` when there is none, `null` when it can't be replayed faithfully. */
function parseBody(raw: string | null): unknown {
  if (!raw) return undefined;
  if (raw.includes('[REDACTED]') || raw.includes('(truncated)')) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseLimit(): number {
  const arg = process.argv.find((a) => a.startsWith('--limit='));
  const n = arg ? Number(arg.slice('--limit='.length)) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 200;
}

async function main(): Promise<void> {
  const client = postgres(resolveDatabaseUrl());
  const db = drizzle(client, { schema });

  // Latest sample per (method, path, statusCode) among root gateway HTTP hops.
  const samples = await db
    .selectDistinctOn([requestLogs.method, requestLogs.path, requestLogs.statusCode], {
      method: requestLogs.method,
      path: requestLogs.path,
      statusCode: requestLogs.statusCode,
      requestBody: requestLogs.requestBody,
      createdAt: requestLogs.createdAt,
    })
    .from(requestLogs)
    .where(
      and(
        eq(requestLogs.serviceName, 'gateway'),
        eq(requestLogs.type, 'HTTP'),
        sql`${requestLogs.method} is not null and ${requestLogs.statusCode} is not null`,
      ),
    )
    .orderBy(
      requestLogs.method,
      requestLogs.path,
      requestLogs.statusCode,
      desc(requestLogs.createdAt),
    );

  let created = 0;
  let skipped = 0;
  let unusable = 0;

  for (const s of samples.slice(0, parseLimit())) {
    const method = s.method!.toUpperCase();
    const status = s.statusCode!;
    if (!SAFE_METHODS.includes(method)) continue;
    if (EXCLUDED_PREFIXES.some((p) => s.path === p || s.path.startsWith(`${p}/`) || s.path.startsWith(`${p}?`))) {
      continue;
    }

    const body = parseBody(s.requestBody);
    if (body === null) {
      unusable++;
      continue;
    }

    const isPublic = PUBLIC_PREFIXES.some((p) => s.path.startsWith(p));
    const name = `[Log] ${method} ${s.path} → ${status}`;

    const [existing] = await db
      .select({ id: testScenarios.id })
      .from(testScenarios)
      .where(
        and(
          eq(testScenarios.method, method),
          eq(testScenarios.path, s.path),
          eq(testScenarios.name, name),
        ),
      )
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }

    await db.insert(testScenarios).values({
      service: 'gateway',
      method,
      path: s.path,
      name,
      description: `Tạo từ request_logs (mẫu gần nhất lúc ${s.createdAt.toISOString()})`,
      requestTemplate: {
        ...(isPublic ? {} : { headers: { authorization: 'Bearer {{accessToken}}' } }),
        ...(body !== undefined ? { body } : {}),
      },
      expectedStatus: status,
      category: categoryFor(status),
    });
    created++;
  }

  console.log(
    `test_scenarios from request_logs: ${created} created, ${skipped} already present, ${unusable} skipped (redacted/truncated body)`,
  );
  await client.end({ timeout: 5 });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
