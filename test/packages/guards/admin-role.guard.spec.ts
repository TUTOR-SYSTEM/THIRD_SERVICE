import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminRoleGuard } from '@packages/guards/admin-role.guard';

const contextWith = (user?: { role: string }) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('AdminRoleGuard', () => {
  const guard = new AdminRoleGuard();

  it('allows an ADMIN user', () => {
    expect(guard.canActivate(contextWith({ role: 'ADMIN' }))).toBe(true);
  });

  it.each(['TUTOR', 'STUDENT', 'PARENT'])('rejects a %s user', (role) => {
    expect(() => guard.canActivate(contextWith({ role }))).toThrow(ForbiddenException);
  });

  it('rejects a request without an authenticated user', () => {
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });
});
