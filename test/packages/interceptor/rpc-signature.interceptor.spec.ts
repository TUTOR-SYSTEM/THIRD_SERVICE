import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { requiresRpcSignature } from '@packages/helpers/redis-keys.policy';
import { signRpcMessage } from '@packages/helpers/rpc-signature.helper';
import { RpcSignatureInterceptor } from '@packages/interceptor/rpc-signature.interceptor';

const SECRET = 'test-rpc-secret';

async function run(interceptor: RpcSignatureInterceptor, pattern: string, data: unknown) {
  const ctx = {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getData: () => data,
      getContext: () => ({ getPattern: () => pattern }),
    }),
  };
  return lastValueFrom(interceptor.intercept(ctx as never, { handle: () => of('handled') }));
}

describe('requiresRpcSignature policy', () => {
  it.each([
    ['redis.set', { key: 'reset-password-otp:u1', value: 'x', ttlSeconds: 300 }],
    ['redis.getdel', { key: 'reset-password:jti' }],
    ['redis.get', { key: 'refresh:u1:abc' }],
    ['redis.incr', { key: 'login-fail:deadbeef', windowSeconds: 900 }],
    ['redis.del', { keys: ['cache:x', 'verify-email:jti'] }],
    ['redis.delByPrefix', { prefix: 'session:3f2504e0-4f89-41d3-9a0c-0305e82c3301:' }],
    ['redis.get', { key: 'Login-Fail:abc' }],
  ])('%s with a sensitive key requires a signature', (pattern, data) => {
    expect(requiresRpcSignature(pattern, data)).toBe(true);
  });

  it('lets the gateway read session keys unsigned (get / exists / ttl)', () => {
    const key = { key: 'session:u1:s1' };
    expect(requiresRpcSignature('redis.get', key)).toBe(false);
    expect(requiresRpcSignature('redis.exists', key)).toBe(false);
    expect(requiresRpcSignature('redis.ttl', key)).toBe(false);
  });

  it('still requires a signature to write or delete session keys', () => {
    expect(
      requiresRpcSignature('redis.set', { key: 'session:u1:s1', value: 'x', ttlSeconds: 9 }),
    ).toBe(true);
    expect(requiresRpcSignature('redis.delByPrefix', { prefix: 'session:u1:' })).toBe(true);
  });

  it('does not require a signature for non-sensitive keys', () => {
    expect(requiresRpcSignature('redis.set', { key: 'cache:x', value: 'x' })).toBe(false);
    expect(requiresRpcSignature('redis.getdel', { key: 'cache:x' })).toBe(false);
  });

  it('always requires a signature for email', () => {
    expect(requiresRpcSignature('email.test', undefined)).toBe(true);
    expect(requiresRpcSignature('email.sendPasswordResetOtp', { to: 'a@b.c' })).toBe(true);
  });

  it('leaves upload and notification patterns to the identity seal', () => {
    expect(requiresRpcSignature('upload.delete', { key: 'k', role: 'ADMIN' })).toBe(false);
    expect(requiresRpcSignature('notification.create', { senderId: 'x' })).toBe(false);
  });
});

describe('RpcSignatureInterceptor', () => {
  const interceptor = new RpcSignatureInterceptor(SECRET);
  const otpSet = { key: 'reset-password-otp:u1', value: 'v', ttlSeconds: 300 };

  it('refuses an unsigned sensitive redis.set with a 403', async () => {
    await expect(run(interceptor, 'redis.set', { ...otpSet })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passes a correctly signed redis.set and strips the signature before the handler', async () => {
    const data = signRpcMessage(otpSet, 'redis.set', SECRET);
    await expect(run(interceptor, 'redis.set', data)).resolves.toBe('handled');
    expect(data).not.toHaveProperty('rpcSig');
    expect(data).not.toHaveProperty('rpcSigTs');
  });

  it('refuses a signed body replayed under a different pattern', async () => {
    const data = signRpcMessage(otpSet, 'redis.set', SECRET);
    await expect(run(interceptor, 'redis.getdel', data)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an unsigned email send, and accepts a signed one', async () => {
    const mail = { to: 'a@b.c', otp: '123456' };
    await expect(
      run(interceptor, 'email.sendPasswordResetOtp', { ...mail }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const signed = signRpcMessage(mail, 'email.sendPasswordResetOtp', SECRET);
    await expect(run(interceptor, 'email.sendPasswordResetOtp', signed)).resolves.toBe('handled');
  });

  it('lets unsigned session reads and non-sensitive keys through', async () => {
    await expect(run(interceptor, 'redis.exists', { key: 'session:u1:s1' })).resolves.toBe(
      'handled',
    );
    await expect(run(interceptor, 'redis.get', { key: 'cache:x' })).resolves.toBe('handled');
  });

  it('fails closed when the secret is empty', async () => {
    const closed = new RpcSignatureInterceptor('');
    await expect(run(closed, 'email.test', undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
