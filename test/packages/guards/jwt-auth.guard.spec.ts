import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '@packages/guards/jwt-auth.guard';
import { RedisService } from 'src/features/redis/redis.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const validPayload = { sub: USER_ID, email: 'a@b.c', typ: 'access', role: 'TUTOR', sid: 'sid-1' };

const contextWith = (headers: Record<string, string> = {}) => {
  const request: { headers: Record<string, string>; user?: unknown } = { headers };
  const ctx = {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
};

describe('JwtAuthGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let jwt: { verify: jest.Mock };
  let config: { get: jest.Mock };
  let userRows: unknown[];
  let redis: { exists: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    jwt = { verify: jest.fn().mockReturnValue(validPayload) };
    config = { get: jest.fn().mockReturnValue('access-secret') };
    userRows = [{ id: USER_ID, isActive: true }];
    redis = { exists: jest.fn().mockResolvedValue(true) };

    const limit = jest.fn(async () => userRows);
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const db = { select: jest.fn(() => ({ from })) };

    guard = new JwtAuthGuard(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      reflector as unknown as Reflector,
      db as never,
      redis as unknown as RedisService,
    );
  });

  it('lets @Public() routes through without reading the token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { ctx } = contextWith();

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('rejects a request without an Authorization header', async () => {
    await expect(guard.canActivate(contextWith().ctx)).rejects.toThrow(UnauthorizedException);
  });

  it.each(['Basic abc', 'Bearer', 'Bearer ', 'token-only'])(
    'rejects a malformed Authorization header: "%s"',
    async (authorization) => {
      await expect(guard.canActivate(contextWith({ authorization }).ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    },
  );

  it('rejects a token that fails signature or expiry verification', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('verifies with JWT_ACCESS_SECRET, falls back to JWT_SECRET, and throws when neither is set', async () => {
    await guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx);
    expect(jwt.verify).toHaveBeenLastCalledWith('t', { secret: 'access-secret' });

    config.get.mockImplementation((key: string) => (key === 'JWT_SECRET' ? 'legacy' : undefined));
    await guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx);
    expect(jwt.verify).toHaveBeenLastCalledWith('t', { secret: 'legacy' });

    // No built-in fallback: a public constant would let anyone mint a valid ADMIN token.
    config.get.mockReturnValue(undefined);
    jwt.verify.mockClear();
    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).rejects.toThrow(
      'JWT_ACCESS_SECRET',
    );
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['a refresh token', { ...validPayload, typ: 'refresh' }],
    ['a payload without sub', { ...validPayload, sub: undefined }],
    ['a payload without email', { ...validPayload, email: undefined }],
    ['a non-object payload', 'string-payload'],
    ['a legacy token without sid', { ...validPayload, sid: undefined }],
    ['a token with an empty sid', { ...validPayload, sid: '' }],
  ])('rejects %s', async (_label, payload) => {
    jwt.verify.mockReturnValue(payload);

    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose user no longer exists in the database', async () => {
    userRows = [];

    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches the decoded user to the request on success', async () => {
    const { ctx, request } = contextWith({ authorization: 'Bearer t' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: USER_ID,
      email: 'a@b.c',
      typ: 'access',
      role: 'TUTOR',
      sid: 'sid-1',
    });
  });

  it('falls back to STUDENT for an unknown role claim', async () => {
    jwt.verify.mockReturnValue({ ...validPayload, role: 'SUPERUSER' });
    const { ctx, request } = contextWith({ authorization: 'Bearer t' });

    await guard.canActivate(ctx);

    expect(request.user).toEqual(expect.objectContaining({ role: 'STUDENT' }));
  });

  it('rejects when the role claim is not a string', async () => {
    jwt.verify.mockReturnValue({ ...validPayload, role: 42 });

    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose session is not in Redis (logged out / revoked)', async () => {
    redis.exists.mockResolvedValue(false);

    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(redis.exists).toHaveBeenCalledWith(`session:${USER_ID}:sid-1`);
  });

  it('rejects a deactivated user even with a live session', async () => {
    userRows = [{ id: USER_ID, isActive: false }];

    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('fails closed with 503 when the session store errors, after one retry', async () => {
    redis.exists.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(redis.exists).toHaveBeenCalledTimes(2);
  });

  it('fails open only when SESSION_CHECK_FAIL_OPEN=true', async () => {
    redis.exists.mockRejectedValue(new Error('ECONNREFUSED'));
    config.get.mockImplementation((key: string) =>
      key === 'SESSION_CHECK_FAIL_OPEN' ? 'true' : 'access-secret',
    );

    await expect(guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx)).resolves.toBe(
      true,
    );
  });

  it('caches a successful session check for a few seconds', async () => {
    await guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx);
    await guard.canActivate(contextWith({ authorization: 'Bearer t' }).ctx);

    expect(redis.exists).toHaveBeenCalledTimes(1);
  });
});
