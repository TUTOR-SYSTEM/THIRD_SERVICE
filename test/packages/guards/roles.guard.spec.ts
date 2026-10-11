import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '@packages/guards/roles.guard';
import { ROLES_KEY } from '@packages/decorators';

const contextWith = (user?: { role: string }) => {
  const request = { user };
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows the request when the route declares no roles', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('allows the request when the roles list is empty', () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('reads roles metadata from the handler first, then the class', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    guard.canActivate(contextWith());

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, ['handler', 'class']);
  });

  it('allows a user whose role is in the required list', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'TUTOR']);

    expect(guard.canActivate(contextWith({ role: 'TUTOR' }))).toBe(true);
  });

  it('rejects a user whose role is not in the required list', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    expect(() => guard.canActivate(contextWith({ role: 'STUDENT' }))).toThrow(ForbiddenException);
  });

  it('rejects a request with no authenticated user when roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });
});
