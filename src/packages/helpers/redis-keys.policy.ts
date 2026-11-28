/**
 * Key families that hold sessions, refresh hashes, reset codes, verification tokens and
 * rate-limit counters (report F-01, F-04). Shared by the HTTP controller (always refused) and the
 * RPC signature rule (refused unless the caller signs the message).
 */
export const SENSITIVE_KEY_PREFIXES: readonly string[] = [
  'session:',
  'login-session:',
  'reset-password:',
  // Password-reset code hashes and their attempt counters (no colon: covers both key shapes).
  'reset-password-otp',
  'refresh:',
  'refresh-token:',
  // Single-use email verification tokens.
  'verify-email:',
  // Session / user revocation markers that in-flight refreshes check.
  'revoked-',
  // Brute-force and rate-limit counters: resetting them unlocks accounts.
  'current-password-attempts:',
  'forgot-password-rate:',
  'login-fail:',
];

/** Read-only calls on these families need no signature (the gateway's session check reads them). */
export const UNSIGNED_READABLE_PREFIXES: readonly string[] = ['session:'];

export const REDIS_TTL_MAX_SECONDS = 30 * 24 * 60 * 60;
export const REDIS_WINDOW_MAX_SECONDS = 24 * 60 * 60;
export const REDIS_MAX_KEYS_PER_CALL = 100;

/**
 * Key families `redis.incr` may count (report F-11). These are the only counters the callers
 * (`user` login lockout, reset-code attempts, forgot-password rate limit, current-password
 * attempts, RPC actor replay) use. Anything else is refused, so a caller cannot create arbitrary
 * counters or touch a family outside its own contract.
 */
export const INCR_ALLOWED_PREFIXES: readonly string[] = [
  'login-fail:',
  'reset-password-otp-attempts:',
  'reset-password-otp-window:',
  'forgot-password-rate:',
  'current-password-attempts:',
  'rpc-actor-replay:',
];

function hasPrefix(key: unknown, prefixes: readonly string[]): boolean {
  if (typeof key !== 'string') return false;
  const lowered = key.toLowerCase();
  return prefixes.some((prefix) => lowered.startsWith(prefix));
}

export function isSensitiveRedisKey(key: unknown): boolean {
  return hasPrefix(key, SENSITIVE_KEY_PREFIXES);
}

export function isIncrAllowedKey(key: unknown): boolean {
  return hasPrefix(key, INCR_ALLOWED_PREFIXES);
}

export function isUnsignedReadableKey(key: unknown): boolean {
  return hasPrefix(key, UNSIGNED_READABLE_PREFIXES);
}

const READ_PATTERNS = new Set(['redis.get', 'redis.exists', 'redis.ttl']);

/** Keys a `redis.*` payload addresses. Non-array `keys` yields none; the controller rejects it. */
export function redisKeysOf(pattern: string, data: unknown): unknown[] {
  const d = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (pattern === 'redis.del') return Array.isArray(d.keys) ? d.keys : [];
  if (pattern === 'redis.delByPrefix') return [d.prefix];
  return [d.key];
}

/**
 * Policy: which RPC messages must carry a valid rpcSig. `email.*` always does;
 * `redis.*` does when it touches a sensitive family (except unsigned reads of session keys).
 * Non-sensitive keys are unchanged.
 */
export function requiresRpcSignature(pattern: string, data: unknown): boolean {
  if (pattern.startsWith('email.')) return true;
  if (!pattern.startsWith('redis.')) return false;
  const sensitive = redisKeysOf(pattern, data).filter(isSensitiveRedisKey);
  if (sensitive.length === 0) return false;
  if (READ_PATTERNS.has(pattern) && sensitive.every(isUnsignedReadableKey)) return false;
  return true;
}
