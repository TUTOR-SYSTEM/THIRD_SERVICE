import { ConfigService } from '@nestjs/config';
import { validateRequiredEnvs } from '@packages/helpers';

const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('validateRequiredEnvs', () => {
  it('returns true when every required env is set', () => {
    expect(validateRequiredEnvs(configWith({ A: 'a', B: 'b' }), ['A', 'B'])).toBe(true);
  });

  it('lists every missing or blank env in the error', () => {
    const config = configWith({ A: '  ', C: 'c' });
    expect(() => validateRequiredEnvs(config, ['A', 'B', 'C'])).toThrow(
      'Missing required environment variables:\n- A\n- B',
    );
  });

  it('passes with an empty requirement list', () => {
    expect(validateRequiredEnvs(configWith({}), [])).toBe(true);
  });
});
