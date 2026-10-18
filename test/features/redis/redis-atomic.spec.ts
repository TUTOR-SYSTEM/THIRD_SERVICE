import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisRpcController } from '../../../src/features/redis/redis.rpc.controller';
import { RedisService } from '../../../src/features/redis/redis.service';

const cfg = () => ({ get: jest.fn(() => undefined) }) as unknown as ConfigService;

describe('RedisService atomic helpers', () => {
  let service: RedisService;

  beforeEach(() => {
    // lazyConnect: no socket is opened until a command runs, and every command is mocked below.
    service = new RedisService(cfg());
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('getdel uses GETDEL so the read and the delete are one atomic step', async () => {
    const spy = jest.spyOn(service.client, 'getdel').mockResolvedValue('user-1');

    await expect(service.getdel('reset-password:abc')).resolves.toBe('user-1');
    expect(spy).toHaveBeenCalledWith('reset-password:abc');
  });

  it('getdel returns null for a missing or already-consumed key', async () => {
    jest.spyOn(service.client, 'getdel').mockResolvedValue(null);

    await expect(service.getdel('reset-password:gone')).resolves.toBeNull();
  });

  it('getdel rejects an empty key without touching Redis', async () => {
    const spy = jest.spyOn(service.client, 'getdel');

    await expect(service.getdel('')).rejects.toBeInstanceOf(BadRequestException);
    expect(spy).not.toHaveBeenCalled();
  });

  it('incrWithWindow runs one Lua script that sets the TTL only on first creation', async () => {
    const spy = jest.spyOn(service.client, 'eval').mockResolvedValue(3);

    await expect(service.incrWithWindow('login-fail:a@b.c', 900)).resolves.toBe(3);

    const [script, numKeys, key, windowSeconds] = spy.mock.calls[0];
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain('if count == 1 then');
    expect(script).toContain("redis.call('EXPIRE'");
    expect(numKeys).toBe(1);
    expect(key).toBe('login-fail:a@b.c');
    expect(windowSeconds).toBe(900);
  });

  it.each([0, -1, 1.5, Number.NaN])('incrWithWindow rejects window %p', async (windowSeconds) => {
    const spy = jest.spyOn(service.client, 'eval');

    await expect(service.incrWithWindow('k', windowSeconds)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('RedisRpcController atomic patterns', () => {
  const makeService = () =>
    ({
      getdel: jest.fn(),
      incrWithWindow: jest.fn(),
    }) as unknown as RedisService & {
      getdel: jest.Mock;
      incrWithWindow: jest.Mock;
    };

  it('redis.getdel forwards the key and replies with the stored value', async () => {
    const service = makeService();
    service.getdel.mockResolvedValue('user-1');
    const controller = new RedisRpcController(service);

    await expect(controller.getdel({ key: 'reset-password:abc' })).resolves.toBe('user-1');
    expect(service.getdel).toHaveBeenCalledWith('reset-password:abc');
  });

  it('redis.incr replies with the count in an object (never undefined)', async () => {
    const service = makeService();
    service.incrWithWindow.mockResolvedValue(2);
    const controller = new RedisRpcController(service);

    await expect(controller.incr({ key: 'login-fail:a', windowSeconds: 900 })).resolves.toEqual({
      count: 2,
    });
    expect(service.incrWithWindow).toHaveBeenCalledWith('login-fail:a', 900);
  });

  it('redis.incr rejects a missing key or a non-positive window', async () => {
    const service = makeService();
    const controller = new RedisRpcController(service);

    await expect(controller.incr({ windowSeconds: 900 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.incr({ key: 'k', windowSeconds: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.incrWithWindow).not.toHaveBeenCalled();
  });
});
