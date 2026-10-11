import type { ExecutionContext } from '@nestjs/common';
import { IS_PUBLIC_KEY, Public } from '@packages/decorators';
import { languageFactory } from '@packages/decorators/language.decorator';
import { currentUserFactory } from '@packages/decorators/user.decorator';
import { THROTTLE_KEY, Throttle } from '@packages/decorators/throttle.decorator';

const ctxWith = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('languageFactory', () => {
  it('returns the language set by the guard', () => {
    expect(languageFactory(undefined, ctxWith({ language: 'en' }))).toBe('en');
  });

  it('falls back to the default language when the guard did not run', () => {
    expect(languageFactory(undefined, ctxWith({}))).toBe('vi');
  });
});

describe('currentUserFactory', () => {
  const user = { sub: 'u1', email: 'a@b.c', typ: 'access', role: 'ADMIN' };

  it('returns the whole user when no key is given', () => {
    expect(currentUserFactory(undefined, ctxWith({ user }))).toBe(user);
  });

  it('returns one claim when a key is given', () => {
    expect(currentUserFactory('role', ctxWith({ user }))).toBe('ADMIN');
  });

  it('returns undefined when there is no authenticated user', () => {
    expect(currentUserFactory(undefined, ctxWith({}))).toBeUndefined();
    expect(currentUserFactory('sub', ctxWith({}))).toBeUndefined();
  });
});

describe('metadata decorators', () => {
  it('@Public sets the IS_PUBLIC metadata', () => {
    const target = class {
      @Public()
      handler() {}
    };
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, target.prototype.handler)).toBe(true);
  });

  it('@Throttle stores limit and ttl', () => {
    const target = class {
      @Throttle(5, 60)
      handler() {}
    };
    expect(Reflect.getMetadata(THROTTLE_KEY, target.prototype.handler)).toEqual({
      limit: 5,
      ttl: 60,
    });
  });
});
