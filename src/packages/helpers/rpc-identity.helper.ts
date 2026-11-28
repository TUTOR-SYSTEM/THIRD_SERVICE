import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Identity seal for RPC messages that name a user or a role (`userId` / `role`).
 *
 * Gateway (and tutor-service, when it forwards a user id it was given) seals such a message with
 * `RPC_ACTOR_SECRET`. The responder (tutor-service, third-service) accepts it only when the seal
 * verifies: the identity fields are covered by `identitySig`, and the pattern plus the payload hash
 * are covered by `identityBind`, so a publisher on the queue cannot change the user, the role, the
 * pattern or the data of a captured envelope. Freshness window: RPC_IDENTITY_MAX_AGE_MS.
 *
 * Keep this file identical in gateway/src/features/rabbitmq/, tutor/src/packages/helpers/ and
 * third/src/packages/helpers/ (same contract as rpc-actor-signature.helper.ts).
 */
export const RPC_IDENTITY_MAX_AGE_MS = 300_000;

const SEAL_FIELDS = ['identitySig', 'identitySigTs', 'identityBind'] as const;

/** True when the message names a user or a role, i.e. it must be sealed to be honoured. */
export function carriesIdentity(message: unknown): boolean {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return false;
  const m = message as Record<string, unknown>;
  return typeof m.userId === 'string' || typeof m.role === 'string';
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** SHA-256 of the payload as it travels on the wire, without the seal fields themselves. */
export function hashIdentityPayload(payload: unknown): string {
  const wire = JSON.parse(JSON.stringify(payload ?? null)) as unknown;
  if (wire !== null && typeof wire === 'object' && !Array.isArray(wire)) {
    for (const field of SEAL_FIELDS) delete (wire as Record<string, unknown>)[field];
  }
  return createHash('sha256').update(canonicalJson(wire)).digest('hex');
}

function mac(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

function sameHex(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Returns a sealed copy of `message` for `pattern`; a message without identity is returned as is. */
export function sealRpcIdentity<T>(
  message: T,
  pattern: string,
  secret: string,
  now = Date.now(),
): T {
  if (!carriesIdentity(message)) return message;
  const m = message as unknown as Record<string, unknown>;
  const userId = typeof m.userId === 'string' ? m.userId : '';
  const role = typeof m.role === 'string' ? m.role : '';
  const identitySig = mac(`id|${userId}|${role}|${now}`, secret);
  const sealed: Record<string, unknown> = { ...m, identitySig, identitySigTs: now };
  sealed.identityBind = mac(
    `bind|${pattern}|${hashIdentityPayload(sealed)}|${identitySig}|${now}`,
    secret,
  );
  return sealed as T;
}

/** True only for a fresh, correctly sealed message. Fails closed on a missing secret or field. */
export function verifyRpcIdentity(
  pattern: string,
  message: unknown,
  secret: string | undefined,
  now = Date.now(),
): boolean {
  if (!secret || !carriesIdentity(message)) return false;
  const m = message as Record<string, unknown>;
  const { identitySig, identitySigTs, identityBind } = m;
  if (typeof identitySig !== 'string' || typeof identitySigTs !== 'number') return false;
  if (typeof identityBind !== 'string') return false;
  if (Math.abs(now - identitySigTs) > RPC_IDENTITY_MAX_AGE_MS) return false;
  const userId = typeof m.userId === 'string' ? m.userId : '';
  const role = typeof m.role === 'string' ? m.role : '';
  if (!sameHex(mac(`id|${userId}|${role}|${identitySigTs}`, secret), identitySig)) return false;
  return sameHex(
    mac(`bind|${pattern}|${hashIdentityPayload(m)}|${identitySig}|${identitySigTs}`, secret),
    identityBind,
  );
}

/** Removes the seal fields in place, so handlers and their persisted data never see them. */
export function stripRpcIdentitySeal(message: unknown): void {
  if (message === null || typeof message !== 'object') return;
  for (const field of SEAL_FIELDS) delete (message as Record<string, unknown>)[field];
}
