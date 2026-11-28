import { BadRequestException } from '@nestjs/common';
import { RedisService } from 'src/features/redis/redis.service';
import { RedisRpcController } from 'src/features/redis/redis.rpc.controller';
import {
  REDIS_MAX_KEYS_PER_CALL,
  REDIS_TTL_MAX_SECONDS,
  REDIS_WINDOW_MAX_SECONDS,
} from '@packages/helpers/redis-keys.policy';

function makeService() {
  const client = {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
  };
  const svc = Object.assign(Object.create(RedisService.prototype), { client });
  return { svc: svc as RedisService, client };
}

describe('Redis caps (report F-11)', () => {
  it('rejects a TTL above 30 days and accepts the limit', async () => {
    const { svc, client } = makeService();
    await expect(svc.set('cache:x', 'v', REDIS_TTL_MAX_SECONDS + 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.set('cache:x', 'v', REDIS_TTL_MAX_SECONDS)).resolves.toBeUndefined();
    expect(client.set).toHaveBeenCalledTimes(1);
  });

  it('rejects a window above 1 day in incrWithWindow', async () => {
    const { svc } = makeService();
    await expect(
      svc.incrWithWindow('login-fail:k', REDIS_WINDOW_MAX_SECONDS + 1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses incr on a key family outside the allowlist, without touching Redis (F-11)', async () => {
    const { svc, client } = makeService();
    await expect(svc.incrWithWindow('cache:x', 60)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.incrWithWindow('session:abc', 60)).rejects.toBeInstanceOf(BadRequestException);
    expect(client.eval).not.toHaveBeenCalled();
  });

  it('allows incr on the counter families the callers use', async () => {
    const { svc, client } = makeService();
    client.eval.mockResolvedValue(1);
    await expect(svc.incrWithWindow('login-fail:deadbeef', 900)).resolves.toBe(1);
    expect(client.eval).toHaveBeenCalledTimes(1);
  });

  it('rejects more than the per-call key limit in del', async () => {
    const { svc, client } = makeService();
    const keys = Array.from({ length: REDIS_MAX_KEYS_PER_CALL + 1 }, (_, i) => 'cache:' + i);
    await expect(svc.del(...keys)).rejects.toBeInstanceOf(BadRequestException);
    expect(client.del).not.toHaveBeenCalled();
  });

  it('RPC redis.del (event) refuses too many keys before touching Redis', () => {
    const redis = { del: jest.fn() };
    const rpc = new RedisRpcController(redis as unknown as RedisService);
    const keys = Array.from({ length: REDIS_MAX_KEYS_PER_CALL + 1 }, (_, i) => 'cache:' + i);
    expect(() => rpc.del({ keys })).toThrow(BadRequestException);
    expect(redis.del).not.toHaveBeenCalled();
  });
});
