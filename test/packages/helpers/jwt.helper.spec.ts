import { signAccessToken, signRefreshToken, type JwtSignContract } from '@packages/helpers';

const config = {
  accessSecret: 'access-secret',
  accessExpiresIn: 100,
  refreshSecret: 'refresh-secret',
  refreshExpiresIn: 200,
};

describe('signAccessToken / signRefreshToken', () => {
  const signAsync = jest.fn().mockResolvedValue('signed');
  const jwtService = { signAsync } as JwtSignContract;

  beforeEach(() => signAsync.mockClear());

  it('signs an access token with the access secret and typ=access', async () => {
    const token = await signAccessToken(
      jwtService,
      { sub: 'u1', email: 'a@b.c', role: 'TUTOR' },
      config,
    );

    expect(token).toBe('signed');
    expect(signAsync).toHaveBeenCalledWith(
      { sub: 'u1', email: 'a@b.c', role: 'TUTOR', typ: 'access' },
      { secret: 'access-secret', expiresIn: 100 },
    );
  });

  it('signs a refresh token with the refresh secret and typ=refresh (no role)', async () => {
    await signRefreshToken(jwtService, { sub: 'u1', email: 'a@b.c' }, config);

    expect(signAsync).toHaveBeenCalledWith(
      { sub: 'u1', email: 'a@b.c', typ: 'refresh' },
      { secret: 'refresh-secret', expiresIn: 200 },
    );
  });

  it('propagates signing errors', async () => {
    signAsync.mockRejectedValueOnce(new Error('sign failed'));
    await expect(
      signRefreshToken(jwtService, { sub: 'u1', email: 'a@b.c' }, config),
    ).rejects.toThrow('sign failed');
  });
});
