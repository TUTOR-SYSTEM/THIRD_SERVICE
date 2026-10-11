import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { RedisController } from 'src/features/redis/redis.controller';
import { RedisService } from 'src/features/redis/redis.service';

describe('RedisController (HTTP)', () => {
  const redis = { get: jest.fn() };
  const controller = new RedisController(redis as unknown as RedisService);

  beforeEach(() => jest.clearAllMocks());

  it('is NOT marked @Public, so the global JwtAuthGuard protects it', () => {
    const isPublic = new Reflector().get<boolean>(IS_PUBLIC_KEY, RedisController.prototype.get);
    expect(isPublic).toBeUndefined();
  });

  it('returns the stored value for an existing key', async () => {
    redis.get.mockResolvedValue('value');

    await expect(controller.get('session:1')).resolves.toBe('value');
    expect(redis.get).toHaveBeenCalledWith('session:1');
  });

  it('returns null (not an error) for a missing key', async () => {
    redis.get.mockResolvedValue(null);

    await expect(controller.get('missing')).resolves.toBeNull();
  });

  it('propagates Redis outages to the caller', async () => {
    redis.get.mockRejectedValue(new Error('Connection is closed.'));

    await expect(controller.get('k')).rejects.toThrow('Connection is closed.');
  });
});
