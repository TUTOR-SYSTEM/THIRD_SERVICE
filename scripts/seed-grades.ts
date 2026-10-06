#!/usr/bin/env bun
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/database/schema';
import { grades } from '../src/database/schema';

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

async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  const client = postgres(url);
  const db = drizzle(client, { schema });

  for (let level = 1; level <= 12; level++) {
    const name = `Lớp ${level}`;

    const existing = await db.select({ id: grades.id }).from(grades).where(eq(grades.level, level)).limit(1);
    if (existing.length > 0) {
      console.log(`Skipped (already exists): ${name}`);
      continue;
    }

    await db.insert(grades).values({ id: randomUUID(), name, level });
    console.log(`Created: ${name}`);
  }

  await client.end({ timeout: 5 });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
