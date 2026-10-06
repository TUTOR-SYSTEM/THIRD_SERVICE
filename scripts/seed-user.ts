import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq, ilike } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/database/schema';
import { users } from '../src/database/schema';
import { hashData } from '../src/packages/helpers/hashingData.helper';

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return databaseUrl;
  }

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

const SEED_ACCOUNTS = [
  {
    email: 'dang04223@gmail.com',
    username: 'admin',
    firstName: 'Admin',
    lastName: 'Account',
    password: 'Admin@123456',
    role: 'ADMIN' as const,
  },
  {
    email: 'student@finance.dev',
    username: 'student',
    firstName: 'Student',
    lastName: 'Account',
    password: 'Student@123456',
    userCode : "ABC123",
    role: 'STUDENT' as const,
  },
  {
    email: 'parent@finance.dev',
    username: 'parent',
    firstName: 'Parent',
    lastName: 'Account',
    userCode : "ABC456",
    password: 'Parent@123456',
    role: 'PARENT' as const,
  },
] satisfies Array<{
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password: string;
  userCode?: string;
  role: 'ADMIN' | 'STUDENT' | 'PARENT';
}>;

async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  const client = postgres(url);
  const db = drizzle(client, { schema });

  for (const account of SEED_ACCOUNTS) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(ilike(users.email, account.email))
      .limit(1);

    if (existing.length > 0) {
      console.log(`Skipped (already exists): ${account.email}`);
      continue;
    }

    const usernameTaken = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, account.username))
      .limit(1);

    if (usernameTaken.length > 0) {
      console.error(`Username already taken: ${account.username}`);
      continue;
    }

    const hashedPassword = await hashData(account.password);
    await db.insert(users).values({
      id: randomUUID(),
      email: account.email,
      username: account.username,
      firstName: account.firstName,
      lastName: account.lastName,
      password: hashedPassword,
      role: account.role,
    });

    console.log(`Created [${account.role}]: ${account.email} (username: ${account.username})`);
  }

  await client.end({ timeout: 5 });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
