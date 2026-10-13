#!/usr/bin/env bun
/**
 * Drop all tables + enums, recreate from schema, seed test users.
 *
 * Usage: bun scripts/recreate-db.ts --confirm-db=<database name>   (refused when NODE_ENV=production)
 */
import 'dotenv/config';
import postgres from 'postgres';
import { execSync } from 'node:child_process';

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

/**
 * Destructive guard: this script drops every table and enum in the target database, and
 * DATABASE_URL usually points at the database shared by all four services. Refuse to run in
 * production, and require the operator to type the target database name back as
 * `--confirm-db=<name>` so a stale or wrong DATABASE_URL cannot wipe the wrong database.
 * Never prints the URL itself (it contains the password).
 */
function assertSafeToRecreate(url: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run: NODE_ENV=production');
  }
  let dbName: string;
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Refusing to run: cannot determine target database name');
  }
  if (!dbName) {
    throw new Error('Refusing to run: target database name is empty');
  }
  const prefix = '--confirm-db=';
  const confirmed = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (confirmed !== dbName) {
    throw new Error(
      `Refusing to run: this drops ALL tables in database "${dbName}". ` +
        `Re-run with --confirm-db=${dbName} to proceed.`,
    );
  }
}

async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  assertSafeToRecreate(url);
  const sql = postgres(url);

  console.log('Dropping all tables…');
  // Drop tables with CASCADE to remove FK dependencies
  const tables = await sql<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  for (const t of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);
  }
  console.log(`  Dropped ${tables.length} table(s)`);

  // Drop all custom enum types
  const enums = await sql<Array<{ typname: string }>>`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  `;
  for (const e of enums) {
    await sql.unsafe(`DROP TYPE IF EXISTS "${e.typname}" CASCADE`);
  }
  console.log(`  Dropped ${enums.length} enum(s)`);

  await sql.end({ timeout: 5 });

  // Push schema via drizzle-kit
  console.log('\nPushing schema via drizzle-kit…');
  execSync('bun x drizzle-kit push --config=drizzle.config.ts --force', {
    stdio: 'inherit',
  });

  // Seed users
  console.log('\nSeeding users…');
  execSync('bun scripts/seed-user.ts', {
    stdio: 'inherit',
  });

  console.log('\nDone. Database recreated and seeded.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
