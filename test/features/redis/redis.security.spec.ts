import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { ROLES_KEY } from '@packages/decorators/roles.decorator';
import { AdminRoleGuard, RolesGuard } from '@packages/guards';
import { RedisController } from 'src/features/redis/redis.controller';
import { RedisRpcController } from 'src/features/redis/redis.rpc.controller';
import { RedisService } from 'src/features/redis/redis.service';
import { AppController } from 'src/app.controller';

const SENSITIVE_KEYS = [
  'session:u1',
  'login-session:u1',
  'reset-password:jti-1',
  'reset-password-otp:u1',
  'reset-password-otp-attempts:u1:c1',
  'refresh:u1',
  'refresh-token:u1',
];

describe('F-01 RedisController HTTP hardening', () => {
  const redis = { get: jest.fn() };
  const controller = new RedisController(redis as unknown as RedisService);
  beforeEach(() => jest.clearAllMocks());

  it('is ADMIN only: not @Public and guarded by AdminRoleGuard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, RedisController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, RedisController)).toContain(AdminRoleGuard);
    expect(Reflect.getMetadata(ROLES_KEY, RedisController)).toBeUndefined();
  });

  it.each(SENSITIVE_KEYS)(
    'rejects sensitive key %s with 403 and never reads Redis',
    async (key) => {
      await expect((async () => controller.get(key))()).rejects.toBeInstanceOf(ForbiddenException);
      expect(redis.get).not.toHaveBeenCalled();
    },
  );

  it('rejects sensitive prefix case-insensitively', async () => {
    await expect((async () => controller.get('SESSION:u1'))()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('still serves a non-sensitive key', async () => {
    redis.get.mockResolvedValue('v');
    await expect(controller.get('cache:foo')).resolves.toBe('v');
  });
});

describe('redis.exists RPC', () => {
  const redis = { exists: jest.fn(), get: jest.fn() };
  const controller = new RedisRpcController(redis as unknown as RedisService);
  beforeEach(() => jest.clearAllMocks());

  it('RedisService has an exists method', () => {
    expect(typeof (RedisService.prototype as any).exists).toBe('function');
  });

  it('RedisService.exists returns boolean from client.exists', async () => {
    const svc = Object.create(RedisService.prototype) as any;
    svc.client = { exists: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) };
    await expect(svc.exists('k')).resolves.toBe(true);
    await expect(svc.exists('k')).resolves.toBe(false);
    expect(svc.client.exists).toHaveBeenCalledWith('k');
  });

  it('binds redis.exists to a handler returning a boolean and never the value', async () => {
    const handler = (RedisRpcController.prototype as any).exists;
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(PATTERN_METADATA, handler)).toEqual(['redis.exists']);
    redis.exists.mockResolvedValue(true);
    await expect((controller as any).exists({ key: 'session:u1' })).resolves.toBe(true);
    expect(redis.exists).toHaveBeenCalledWith('session:u1');
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('keeps redis.get RPC returning the value for internal callers (USER)', async () => {
    redis.get.mockResolvedValue('refresh-token');
    await expect(controller.get({ key: 'session:u1' })).resolves.toBe('refresh-token');
  });
});

describe('F-02/F-40 health.redis never leaks values', () => {
  function build(client: Record<string, jest.Mock>) {
    return new AppController({ getHello: jest.fn() } as any, { client } as unknown as RedisService);
  }
  const okClient = () => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    info: jest.fn().mockResolvedValue('used_memory:1\r\nx:1'),
    dbsize: jest.fn().mockResolvedValue(3),
    scan: jest.fn().mockResolvedValue(['0', ['session:u1']]),
    mget: jest.fn().mockResolvedValue(['SECRET-JWT']),
    get: jest.fn().mockResolvedValue('SECRET-JWT'),
  });

  it('does not call MGET/GET/SCAN even with fetchData:true and output has no values', async () => {
    const client = okClient();
    const res = await build(client).checkRedisHealth({ fetchData: true });
    expect(client.mget).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).not.toContain('SECRET-JWT');
    expect(res).not.toHaveProperty('sampleKeys');
    expect(JSON.stringify(res)).not.toContain('session:u1');
  });

  it('returns generic "Redis unavailable" and no internal error text on failure', async () => {
    const client = okClient();
    client.ping.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:6379 password=hunter2'));
    const res = (await build(client).checkRedisHealth()) as { message: string };
    expect(res.message).toBe('Redis unavailable');
    expect(JSON.stringify(res)).not.toContain('hunter2');
  });
});
