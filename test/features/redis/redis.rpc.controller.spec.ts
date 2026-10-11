import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { RedisRpcController } from 'src/features/redis/redis.rpc.controller';
import { RedisService } from 'src/features/redis/redis.service';

describe('RedisRpcController', () => {
  const redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const controller = new RedisRpcController(redis as unknown as RedisService);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['redis.get', 'get'],
    ['redis.set', 'set'],
    ['redis.del', 'del'],
  ])('binds %s to the %s handler', (pattern, method) => {
    expect(Reflect.getMetadata(PATTERN_METADATA, RedisRpcController.prototype[method as keyof RedisRpcController])).toEqual([pattern]);
  });

  it('get returns the value from RedisService', async () => {
    redis.get.mockResolvedValue('v');

    await expect(controller.get({ key: 'k' })).resolves.toBe('v');
    expect(redis.get).toHaveBeenCalledWith('k');
  });

  it('set replies with a non-undefined ok marker so RmqProducer.send() does not see an empty reply', async () => {
    redis.set.mockResolvedValue(undefined);

    await expect(controller.set({ key: 'k', value: 'v', ttlSeconds: 60 })).resolves.toEqual({ ok: true });
    expect(redis.set).toHaveBeenCalledWith('k', 'v', 60);
  });

  it('set forwards an undefined ttl when none is provided', async () => {
    await controller.set({ key: 'k', value: 'v' });

    expect(redis.set).toHaveBeenCalledWith('k', 'v', undefined);
  });

  it('set propagates write failures instead of replying ok', async () => {
    redis.set.mockRejectedValue(new Error('READONLY'));

    await expect(controller.set({ key: 'k', value: 'v' })).rejects.toThrow('READONLY');
  });

  it('del spreads the key list into RedisService.del', async () => {
    redis.del.mockResolvedValue(2);

    await expect(controller.del({ keys: ['a', 'b'] })).resolves.toBe(2);
    expect(redis.del).toHaveBeenCalledWith('a', 'b');
  });
});
