import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from '@packages/guards/jwt-auth.guard';

// F-04
describe('JwtAuthGuard (review-fix F-04)', () => {
  it('never verifies with a hardcoded fallback secret when no secret is configured', async () => {
    const verify = jest
      .fn()
      .mockReturnValue({ sub: 'u1', email: 'a@b.c', typ: 'access', role: 'ADMIN' });
    const limit = jest.fn(async () => [{ id: 'u1' }]);
    const db = { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) };
    const guard = new JwtAuthGuard(
      { verify } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      db as any,
    );
    const request = { headers: { authorization: 'Bearer tok' } };
    const ctx = {
      getHandler: () => 'h',
      getClass: () => 'c',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toBeDefined();
    for (const call of verify.mock.calls) {
      expect(call[1].secret).not.toMatch(/dev-insecure/);
    }
  });
});
