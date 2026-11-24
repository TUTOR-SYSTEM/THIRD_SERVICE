/**
 * Create a single wallet for an existing user. Usage:
 *   SEED_WALLET_EMAIL=user@example.com bun scripts/seed-wallet.ts
 *
 * NOTE: Wallets table is commented out in schema.ts.
 * If you need to seed wallets, uncomment the wallets table first.
 */
import 'dotenv/config';
import './_guard-not-production';

function main(): void {
  console.log('Wallets table is currently disabled (commented out in schema.ts).');
  console.log('To re-enable: uncomment the wallets table in src/database/schema.ts');
  console.log('Then this script can be used to seed default wallets.');
}

main();
