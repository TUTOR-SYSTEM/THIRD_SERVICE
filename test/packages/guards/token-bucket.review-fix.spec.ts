import { ExecutionContext } from '@nestjs/common';
import { TokenBucketGuard } from '@packages/guards/token-bucket.guard';

const build = (evalImpl: jest.Mock) => {
  const guard = new TokenBucketGuard(
    { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as any,
    { client: { eval: evalImpl } } as any,
  );
  const request: any = {
    ip: '1.1.1.1',
    method: 'GET',
    path: '/notifications/123',
    route: { path: '/notifications/:id' },
    res: { setHeader: jest.fn() },
  };
  const ctx = {
    getHandler: () => 'h',
    getClass: () => 'c',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, ctx, request };
};

describe('TokenBucketGuard (review-fix)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // F-14
  it('fails open (allows the request) when redis eval rejects', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { guard, ctx } = build(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // F-14
  it('fails open within a bounded time when redis eval never resolves', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { guard, ctx } = build(jest.fn(() => new Promise(() => undefined)));
    const result = guard.canActivate(ctx);
    await jest.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toBe(true);
  });

  // F-16
  it('keys the bucket by route pattern, not the concrete path', async () => {
    const evalMock = jest.fn().mockResolvedValue([1, 59, 60, 0]);
    const { guard, ctx } = build(evalMock);
    await guard.canActivate(ctx);
    const key = evalMock.mock.calls[0][2] as string;
    expect(key).toContain('/notifications/:id');
    expect(key).not.toContain('/notifications/123');
  });

  // F-16 (still enforces limit)
  it('still returns 429 when the bucket is empty', async () => {
    const { guard, ctx } = build(jest.fn().mockResolvedValue([0, 0, 60, 3]));
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 429 });
  });
});
