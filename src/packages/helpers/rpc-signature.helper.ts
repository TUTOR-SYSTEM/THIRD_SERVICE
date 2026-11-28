import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature over a whole RPC message, keyed with RPC_ACTOR_SECRET (report F-01, F-06, F-07).
 *
 * Used for the calls that must come from a trusted service and carry no user identity:
 * `redis.*` on sensitive key families, and `email.*`. The sender adds
 * `rpcSig` and `rpcSigTs` (see signRpcMessage); the responder accepts the message only when the
 * MAC verifies and `rpcSigTs` is within RPC_SIGNATURE_MAX_AGE_MS. The MAC covers the pattern and
 * the canonical JSON of every other field, so a publisher on the queue cannot change the pattern,
 * the key, the value or the recipient of a captured message.
 *
 * Keep this file identical in gateway/user/third (same contract as rpc-identity.helper.ts).
 */
export const RPC_SIGNATURE_MAX_AGE_MS = 300_000;

const SIGNATURE_FIELDS = ['rpcSig', 'rpcSigTs'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(obj)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}

function digestOf(message: Record<string, unknown>): string {
  const wire = JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
  for (const field of SIGNATURE_FIELDS) delete wire[field];
  return createHash('sha256').update(canonicalJson(wire)).digest('hex');
}

function macOf(pattern: string, digest: string, ts: number, secret: string): string {
  return createHmac('sha256', secret)
    .update('sig|' + pattern + '|' + digest + '|' + ts)
    .digest('hex');
}

function sameHex(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Returns a copy of `message` carrying `rpcSig` and `rpcSigTs` for `pattern`. */
export function signRpcMessage<T extends object>(
  message: T,
  pattern: string,
  secret: string,
  now: number = Date.now(),
): T & { rpcSig: string; rpcSigTs: number } {
  if (!secret) throw new Error('RPC signing secret is required');
  if (!isPlainObject(message)) throw new TypeError('only object payloads can be signed');
  const base: Record<string, unknown> = { ...message };
  for (const field of SIGNATURE_FIELDS) delete base[field];
  const rpcSig = macOf(pattern, digestOf(base), now, secret);
  return { ...base, rpcSig, rpcSigTs: now } as T & { rpcSig: string; rpcSigTs: number };
}

/** True only for a fresh message whose MAC matches `pattern`. Fails closed on any missing piece. */
export function verifyRpcSignature(
  pattern: string,
  message: unknown,
  secret: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!secret || !isPlainObject(message)) return false;
  const { rpcSig, rpcSigTs } = message;
  if (typeof rpcSig !== 'string' || typeof rpcSigTs !== 'number' || !Number.isFinite(rpcSigTs)) {
    return false;
  }
  if (Math.abs(now - rpcSigTs) > RPC_SIGNATURE_MAX_AGE_MS) return false;
  return sameHex(macOf(pattern, digestOf(message), rpcSigTs, secret), rpcSig);
}

/** Removes the signature fields in place so handlers and persisted data never see them. */
export function stripRpcSignature(message: unknown): void {
  if (!isPlainObject(message)) return;
  for (const field of SIGNATURE_FIELDS) delete message[field];
}
