import { ConfigService } from '@nestjs/config';
import { getJwtTokensConfig } from '../../../src/packages/configs/jwt-sign.config';

const cfg = (v: Record<string, string | undefined>) =>
  ({ get: jest.fn((k: string) => v[k]) }) as unknown as ConfigService;

// F-04
describe('getJwtTokensConfig (review-fix F-04)', () => {
  it('throws instead of falling back to a hardcoded secret when no secret is configured', () => {
    expect(() => getJwtTokensConfig(cfg({}))).toThrow(/JWT_ACCESS_SECRET|JWT_SECRET/);
  });

  it('prefers JWT_ACCESS_SECRET, then JWT_SECRET', () => {
    expect(getJwtTokensConfig(cfg({ JWT_ACCESS_SECRET: 'a', JWT_SECRET: 'b' })).accessSecret).toBe('a');
    expect(getJwtTokensConfig(cfg({ JWT_SECRET: 'b' })).accessSecret).toBe('b');
  });
});
