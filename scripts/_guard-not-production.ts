// Seed scripts create accounts with well-known passwords: never allow them against production.
if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run a seed script with NODE_ENV=production');
}
