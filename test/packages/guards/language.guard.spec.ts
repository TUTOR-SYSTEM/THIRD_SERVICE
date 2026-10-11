import type { ExecutionContext } from '@nestjs/common';
import { LanguageGuard, type RequestWithLanguage } from '@packages/guards/language.guard';

const runWith = (acceptLanguage?: string) => {
  const request = {
    headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage },
  } as RequestWithLanguage;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const allowed = new LanguageGuard().canActivate(ctx);
  return { allowed, language: request.language };
};

describe('LanguageGuard', () => {
  it('always allows the request and defaults to vi without a header', () => {
    expect(runWith()).toEqual({ allowed: true, language: 'vi' });
  });

  it.each([
    ['en-US', 'en'],
    ['vi-VN,vi;q=0.9,en;q=0.8', 'vi'],
    ['fr,en;q=0.5', 'en'],
    ['fr-FR, en-GB;q=0.8', 'en'],
    ['en;q=0.3,vi;q=0.9', 'vi'],
    ['EN-us', 'en'],
  ])('resolves %j to %s', (header, expected) => {
    expect(runWith(header).language).toBe(expected);
  });

  it('falls back to vi when no supported language is listed', () => {
    expect(runWith('fr-FR,de;q=0.8').language).toBe('vi');
  });

  it('treats a malformed q value as weight 0 (ranked last)', () => {
    expect(runWith('en;q=abc,vi;q=0.1').language).toBe('vi');
  });

  // BUG (expected to fail): RFC 7231 says `q=0` means "not acceptable", yet the guard
  // still picks `en` when it is the only supported tag, because weight is only used for sorting.
  it.failing('does not pick a language the client marked as q=0 (not acceptable)', () => {
    expect(runWith('en;q=0, fr;q=0.5').language).toBe('vi');
  });
});
