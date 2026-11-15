import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/** Same resolution as `src/database/schema.ts` consumers (DATABASE_URL or POSTGRES_*). */
function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return databaseUrl;
  }

  const host = process.env.POSTGRES_HOST?.trim() || 'localhost';
  const port = process.env.POSTGRES_PORT?.trim() || '5432';
  const db = process.env.POSTGRES_DB?.trim() || 'backends_db';
  const user = process.env.POSTGRES_USER?.trim() || 'postgres';
  const password = process.env.POSTGRES_PASSWORD?.trim() || 'postgres';

  const url = new URL(`postgres://${host}:${port}/${db}`);
  url.username = user;
  url.password = password;
  return url.toString();
}

export default defineConfig({
  out: './drizzle',
  schema: './src/database/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
  verbose: true,
  strict: true,
});
