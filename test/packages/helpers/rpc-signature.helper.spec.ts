import {
  RPC_SIGNATURE_MAX_AGE_MS,
  signRpcMessage,
  stripRpcSignature,
  verifyRpcSignature,
} from '@packages/helpers/rpc-signature.helper';

const SECRET = 'test-rpc-secret';
const NOW = 1_800_000_000_000;

describe('rpc-signature helper', () => {
  const payload = { key: 'reset-password-otp:u1', value: '{"hash":"x"}', ttlSeconds: 300 };

  it('verifies a freshly signed message for the same pattern', () => {
    const signed = signRpcMessage(payload, 'redis.set', SECRET, NOW);
    expect(verifyRpcSignature('redis.set', signed, SECRET, NOW + 1000)).toBe(true);
  });

  it('rejects a message whose payload was changed after signing', () => {
    const signed = signRpcMessage(payload, 'redis.set', SECRET, NOW);
    expect(verifyRpcSignature('redis.set', { ...signed, value: 'forged' }, SECRET, NOW)).toBe(
      false,
    );
    expect(verifyRpcSignature('redis.set', { ...signed, ttlSeconds: 1e9 }, SECRET, NOW)).toBe(
      false,
    );
  });

  it('rejects the same signed body sent under another pattern', () => {
    const signed = signRpcMessage(payload, 'redis.set', SECRET, NOW);
    expect(verifyRpcSignature('redis.getdel', signed, SECRET, NOW)).toBe(false);
  });

  it('rejects a message signed with another secret', () => {
    const signed = signRpcMessage(payload, 'redis.set', 'other-secret', NOW);
    expect(verifyRpcSignature('redis.set', signed, SECRET, NOW)).toBe(false);
  });

  it('rejects a stale message (replay outside the freshness window)', () => {
    const signed = signRpcMessage(payload, 'redis.set', SECRET, NOW);
    expect(
      verifyRpcSignature('redis.set', signed, SECRET, NOW + RPC_SIGNATURE_MAX_AGE_MS + 1),
    ).toBe(false);
  });

  it('fails closed on a missing secret, missing fields or a non-object', () => {
    const signed = signRpcMessage(payload, 'redis.set', SECRET, NOW);
    expect(verifyRpcSignature('redis.set', signed, undefined, NOW)).toBe(false);
    expect(verifyRpcSignature('redis.set', payload, SECRET, NOW)).toBe(false);
    expect(verifyRpcSignature('redis.set', 'redis.set', SECRET, NOW)).toBe(false);
    expect(verifyRpcSignature('redis.set', null, SECRET, NOW)).toBe(false);
  });

  it('does not cover the signature fields themselves (key order is irrelevant)', () => {
    const signed = signRpcMessage(payload, 'redis.set', SECRET, NOW);
    const reordered = { rpcSigTs: signed.rpcSigTs, rpcSig: signed.rpcSig, ...payload };
    expect(verifyRpcSignature('redis.set', reordered, SECRET, NOW)).toBe(true);
  });

  it('strips the signature fields in place', () => {
    const signed = signRpcMessage(payload, 'redis.set', SECRET, NOW) as Record<string, unknown>;
    stripRpcSignature(signed);
    expect(signed).not.toHaveProperty('rpcSig');
    expect(signed).not.toHaveProperty('rpcSigTs');
    expect(signed.key).toBe(payload.key);
  });

  it('refuses to sign without a secret or with a non-object payload', () => {
    expect(() => signRpcMessage(payload, 'redis.set', '')).toThrow();
    expect(() => signRpcMessage('x' as unknown as object, 'redis.set', SECRET)).toThrow(TypeError);
  });
});
