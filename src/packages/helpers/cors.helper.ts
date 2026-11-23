/**
 * Resolve the CORS `origin` option from env.
 * - `CORS_ORIGINS` (comma separated) set -> allowlist.
 * - otherwise `true` only for NODE_ENV=development|test, `false` for anything else (incl. unset).
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] | boolean {
  const list = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (list.length > 0) {
    return list;
  }
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

/** `TRUST_PROXY` = number of proxy hops; undefined when unset/invalid. */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
