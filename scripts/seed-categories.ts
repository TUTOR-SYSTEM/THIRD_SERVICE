/**
 * Seed default top-level categories. Usage:
 *   bun scripts/seed-categories.ts
 *
 * NOTE: Categories table is commented out in schema.ts.
 * If you need to seed categories, uncomment the categories table first.
 */
import 'dotenv/config';
import './_guard-not-production';

function main(): void {
  console.log('Categories table is currently disabled (commented out in schema.ts).');
  console.log('To re-enable: uncomment the categories table in src/database/schema.ts');
  console.log('Then this script can be used to seed default categories.');
}

main();
