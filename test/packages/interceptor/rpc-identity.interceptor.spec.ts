import { ForbiddenException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { RpcIdentityInterceptor } from '@packages/interceptor/rpc-identity.interceptor';
import { sealRpcIdentity } from '@packages/helpers/rpc-identity.helper';

const SECRET = 'test-secret';

function rpcContext(pattern: string, data: unknown): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getData: () => data,
      getContext: () => ({ getPattern: () => pattern }),
    }),
  } as unknown as ExecutionContext;
}

const next = (seen: { data?: unknown }): CallHandler => ({
  handle: () => {
    seen.data = 'handled';
    return of('ok');
  },
});

describe('RpcIdentityInterceptor', () => {
  const interceptor = new RpcIdentityInterceptor(SECRET);

  it('passes a sealed message and strips the seal before the handler', async () => {
    const sealed = sealRpcIdentity({ userId: 'u1', role: 'TUTOR' }, 'class.getAll', SECRET);
    const data = { ...sealed };
    const seen: { data?: unknown } = {};
    const out = await lastValueFrom(
      interceptor.intercept(rpcContext('class.getAll', data), next(seen)),
    );
    expect(out).toBe('ok');
    expect(seen.data).toBe('handled');
    expect(data).toEqual({ userId: 'u1', role: 'TUTOR' });
  });

  it('rejects an unsealed message that names a user with 403', () => {
    expect(() =>
      interceptor.intercept(rpcContext('class.delete', { userId: 'u1', role: 'ADMIN' }), next({})),
    ).toThrow(ForbiddenException);
  });

  it('lets messages without identity through', async () => {
    await expect(
      lastValueFrom(interceptor.intercept(rpcContext('redis.get', { key: 'k' }), next({}))),
    ).resolves.toBe('ok');
  });
});
