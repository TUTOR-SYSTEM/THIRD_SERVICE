import {
  sealRpcIdentity,
  stripRpcIdentitySeal,
  verifyRpcIdentity,
  RPC_IDENTITY_MAX_AGE_MS,
} from '@packages/helpers/rpc-identity.helper';

const SECRET = 'test-secret';
const NOW = 1_800_000_000_000;

describe('rpc identity seal', () => {
  const pattern = 'class.getAll';
  const sealed = (msg: Record<string, unknown>, now = NOW) =>
    sealRpcIdentity(msg, pattern, SECRET, now);

  it('accepts a message sealed for the same pattern and payload', () => {
    const msg = sealed({ userId: 'u1', role: 'TUTOR', query: { page: 1 } });
    expect(verifyRpcIdentity(pattern, msg, SECRET, NOW)).toBe(true);
  });

  it('rejects an unsealed message that names a user', () => {
    expect(verifyRpcIdentity(pattern, { userId: 'u1', role: 'ADMIN' }, SECRET, NOW)).toBe(false);
  });

  it('rejects a forged role or user id on a captured envelope', () => {
    const msg = sealed({ userId: 'u1', role: 'TUTOR' });
    expect(verifyRpcIdentity(pattern, { ...msg, role: 'ADMIN' }, SECRET, NOW)).toBe(false);
    expect(verifyRpcIdentity(pattern, { ...msg, userId: 'admin' }, SECRET, NOW)).toBe(false);
  });

  it('rejects a changed payload or a changed pattern', () => {
    const msg = sealed({ userId: 'u1', role: 'TUTOR', id: 'c1' });
    expect(verifyRpcIdentity(pattern, { ...msg, id: 'c2' }, SECRET, NOW)).toBe(false);
    expect(verifyRpcIdentity('class.delete', msg, SECRET, NOW)).toBe(false);
  });

  it('rejects a stale seal and a wrong secret', () => {
    const msg = sealed({ userId: 'u1', role: 'TUTOR' });
    expect(verifyRpcIdentity(pattern, msg, SECRET, NOW + RPC_IDENTITY_MAX_AGE_MS + 1)).toBe(false);
    expect(verifyRpcIdentity(pattern, msg, 'other', NOW)).toBe(false);
    expect(verifyRpcIdentity(pattern, msg, undefined, NOW)).toBe(false);
  });

  it('does not seal messages that carry no identity', () => {
    const plain = { key: 'cache:x' };
    expect(sealRpcIdentity(plain, 'redis.get', SECRET, NOW)).toBe(plain);
  });

  it('strips seal fields so the handler only sees the business payload', () => {
    const msg = sealed({ userId: 'u1', role: 'TUTOR' });
    stripRpcIdentitySeal(msg);
    expect(msg).toEqual({ userId: 'u1', role: 'TUTOR' });
  });
});
