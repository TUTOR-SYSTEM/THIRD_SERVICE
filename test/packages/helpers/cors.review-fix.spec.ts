import { resolveCorsOrigins, resolveTrustProxy } from '../../../src/packages/helpers/cors.helper';
import { sanitizeLogMessage } from '../../../src/packages/helpers/sanitize-log.helper';

describe('resolveCorsOrigins (F-18)', () => {
  it('uses the trimmed CORS_ORIGINS allowlist, dropping empties', () => {
    expect(resolveCorsOrigins({ CORS_ORIGINS: ' https://a.com, ,https://b.com ,' } as any)).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
  it('allowlist wins even in production', () => {
    expect(resolveCorsOrigins({ CORS_ORIGINS: 'https://a.com', NODE_ENV: 'production' } as any)).toEqual(['https://a.com']);
  });
  it('is true outside production and false in production without an allowlist', () => {
    expect(resolveCorsOrigins({} as any)).toBe(true);
    expect(resolveCorsOrigins({ NODE_ENV: 'development', CORS_ORIGINS: '  ' } as any)).toBe(true);
    expect(resolveCorsOrigins({ NODE_ENV: 'production' } as any)).toBe(false);
  });
});

describe('resolveTrustProxy (F-16)', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['abc', undefined],
    ['-1', undefined],
    ['1.5', undefined],
    ['0', 0],
    [' 2 ', 2],
  ])('TRUST_PROXY=%j -> %j', (raw, expected) => {
    expect(resolveTrustProxy({ TRUST_PROXY: raw } as any)).toBe(expected);
  });
});

describe('sanitizeLogMessage (F-20)', () => {
  it('strips params from a Failed query message', () => {
    const out = sanitizeLogMessage('Failed query: select 1 where e = $1\nparams: secret@x.com');
    expect(out).toContain('Failed query: select 1');
    expect(out).not.toContain('secret@x.com');
  });
  it('leaves other messages untouched', () => {
    expect(sanitizeLogMessage('boom params: x')).toBe('boom params: x');
  });
  it('leaves a Failed query without params untouched', () => {
    expect(sanitizeLogMessage('Failed query: select 1')).toBe('Failed query: select 1');
  });
});
