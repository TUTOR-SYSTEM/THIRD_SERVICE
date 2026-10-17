import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { RedisRpcController } from 'src/features/redis/redis.rpc.controller';
import { RedisService } from 'src/features/redis/redis.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const makeService = () => {
  const fake = {
    scan: jest.fn(),
    del: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
    connect: jest.fn(),
    status: 'wait',
  };
  const service = new RedisService({ get: jest.fn() } as unknown as ConfigService);
  (service as unknown as { client: unknown }).client = fake;
  return { service, fake };
};

describe('RedisService.delByPrefix', () => {
  it.each([`session:${USER_ID}:`, `refresh:${USER_ID}:`])(
    'scans and deletes keys under the allowed prefix %s',
    async (prefix) => {
      const { service, fake } = makeService();
      fake.scan
        .mockResolvedValueOnce(['5', [`${prefix}a`, `${prefix}b`]])
        .mockResolvedValueOnce(['0', [`${prefix}c`]]);
      fake.del.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      await expect(service.delByPrefix(prefix)).resolves.toBe(3);
      expect(fake.scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', `${prefix}*`, 'COUNT', 200);
      expect(fake.scan).toHaveBeenNthCalledWith(2, '5', 'MATCH', `${prefix}*`, 'COUNT', 200);
      expect(fake.del).toHaveBeenCalledWith(`${prefix}a`, `${prefix}b`);
    },
  );

  it('never uses KEYS', async () => {
    const { service, fake } = makeService();
    fake.scan.mockResolvedValue(['0', []]);

    await service.delByPrefix(`session:${USER_ID}:`);
    expect(fake.del).not.toHaveBeenCalled();
    expect(fake).not.toHaveProperty('keys');
  });

  it.each([
    [''],
    ['*'],
    ['session:'],
    [`session:${USER_ID}`],
    [`session:${USER_ID}:*`],
    [`reset-password:${USER_ID}:`],
    [`session:not-a-uuid:`],
    [`session:${USER_ID}:x`],
  ])('rejects the disallowed prefix %p without touching Redis', async (prefix) => {
    const { service, fake } = makeService();

    await expect(service.delByPrefix(prefix)).rejects.toThrow(BadRequestException);
    expect(fake.scan).not.toHaveBeenCalled();
  });
});

describe('RedisRpcController redis.delByPrefix', () => {
  const redis = { delByPrefix: jest.fn(), set: jest.fn() };
  const controller = new RedisRpcController(redis as unknown as RedisService);

  beforeEach(() => jest.clearAllMocks());

  it('binds the redis.delByPrefix pattern', () => {
    expect(Reflect.getMetadata(PATTERN_METADATA, RedisRpcController.prototype.delByPrefix)).toEqual(
      ['redis.delByPrefix'],
    );
  });

  it('replies { deleted } from the service', async () => {
    redis.delByPrefix.mockResolvedValue(4);

    await expect(controller.delByPrefix({ prefix: `refresh:${USER_ID}:` })).resolves.toEqual({
      deleted: 4,
    });
    expect(redis.delByPrefix).toHaveBeenCalledWith(`refresh:${USER_ID}:`);
  });

  it.each([[{}], [{ prefix: '*' }], [{ prefix: 'session:' }], [{ prefix: 42 }], [null]])(
    'rejects payload %p before calling Redis',
    async (payload) => {
      await expect(controller.delByPrefix(payload)).rejects.toThrow(BadRequestException);
      expect(redis.delByPrefix).not.toHaveBeenCalled();
    },
  );
});

describe('RedisRpcController redis.set TTL guard', () => {
  const redis = { set: jest.fn().mockResolvedValue(undefined) };
  const controller = new RedisRpcController(redis as unknown as RedisService);

  beforeEach(() => jest.clearAllMocks());

  it.each([`session:${USER_ID}:sid`, `refresh:${USER_ID}:sid`, `reset-password:abc`])(
    'refuses a sensitive key %s without ttlSeconds',
    async (key) => {
      await expect(controller.set({ key, value: 'v' })).rejects.toThrow(BadRequestException);
      expect(redis.set).not.toHaveBeenCalled();
    },
  );

  it('still allows ordinary keys without a TTL', async () => {
    await expect(controller.set({ key: 'plain', value: 'v' })).resolves.toEqual({ ok: true });
  });
});
