import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/features/redis/redis.service';

type Listeners = Record<string, (...args: unknown[]) => void>;

const ioredisState = {
  instances: [] as Array<{
    args: unknown[];
    status: string;
    on: jest.Mock;
    connect: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    quit: jest.Mock;
    disconnect: jest.Mock;
    listeners: Listeners;
  }>,
};

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation((...args: unknown[]) => {
    const listeners: Listeners = {};
    const instance = {
      args,
      status: 'wait',
      listeners,
      on: jest.fn((event: string, cb: (...a: unknown[]) => void) => {
        listeners[event] = cb;
        return instance;
      }),
      connect: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(2),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };
    ioredisState.instances.push(instance);
    return instance;
  }),
}));

const makeConfig = (values: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

const lastClient = () => ioredisState.instances[ioredisState.instances.length - 1];

describe('RedisService', () => {
  beforeEach(() => {
    ioredisState.instances.length = 0;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('connection setup', () => {
    it('uses REDIS_URL when provided and labels logs with REDIS_URL', () => {
      new RedisService(makeConfig({ REDIS_URL: '  redis://cache:6379/0  ' }));

      const client = lastClient();
      expect(client.args[0]).toBe('redis://cache:6379/0');
      expect(client.args[1]).toMatchObject({ lazyConnect: true, maxRetriesPerRequest: null });
    });

    it('falls back to host/port/password when REDIS_URL is blank', () => {
      new RedisService(
        makeConfig({ REDIS_URL: '   ', REDIS_HOST: 'redis.internal', REDIS_PORT: '6399', REDIS_PASSWORD: 'pw' }),
      );

      expect(lastClient().args[0]).toMatchObject({ host: 'redis.internal', port: 6399, password: 'pw' });
    });

    it('defaults to localhost:6380 with no password when nothing is configured', () => {
      new RedisService(makeConfig({}));

      expect(lastClient().args[0]).toMatchObject({
        host: 'localhost',
        port: 6380,
        password: undefined,
      });
    });

    it('falls back to port 6380 when REDIS_PORT is not numeric', () => {
      new RedisService(makeConfig({ REDIS_PORT: 'abc' }));

      expect(lastClient().args[0]).toMatchObject({ port: 6380 });
    });

    it('logs a warning with the endpoint on connection errors and logs on connect/ready', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      new RedisService(makeConfig({ REDIS_HOST: 'h', REDIS_PORT: '1' }));
      const client = lastClient();

      client.listeners.error(new Error('ECONNREFUSED'));
      client.listeners.connect();
      client.listeners.ready();

      expect(String(warn.mock.calls[0][0])).toContain('ECONNREFUSED');
      expect(String(warn.mock.calls[0][0])).toContain('h:1');
      expect(String(log.mock.calls[0][0])).toContain('connected');
      expect(String(log.mock.calls[1][0])).toContain('ready');
    });
  });

  describe('onModuleInit', () => {
    it('connects explicitly when the client is still in wait state', async () => {
      const service = new RedisService(makeConfig({}));

      await service.onModuleInit();

      expect(lastClient().connect).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the client is already connecting or connected (double Nest lifecycle)', async () => {
      const service = new RedisService(makeConfig({}));
      lastClient().status = 'ready';

      await service.onModuleInit();

      expect(lastClient().connect).not.toHaveBeenCalled();
    });

    it('does not throw when the initial connect fails; ioredis keeps retrying in background', async () => {
      const service = new RedisService(makeConfig({ REDIS_HOST: 'down' }));
      lastClient().connect.mockRejectedValue(new Error('connect ETIMEDOUT'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('commands', () => {
    it('get returns the stored string or null when the key is absent', async () => {
      const service = new RedisService(makeConfig({}));
      lastClient().get.mockResolvedValueOnce('v1').mockResolvedValueOnce(null);

      await expect(service.get('k')).resolves.toBe('v1');
      await expect(service.get('missing')).resolves.toBeNull();
      expect(lastClient().get).toHaveBeenCalledWith('k');
    });

    it('set uses EX when ttlSeconds is a positive number', async () => {
      const service = new RedisService(makeConfig({}));

      await service.set('token', 'abc', 300);

      expect(lastClient().set).toHaveBeenCalledWith('token', 'abc', 'EX', 300);
    });

    it.each([
      ['undefined', undefined],
      ['zero', 0],
      ['negative', -5],
    ])('set omits expiry when ttlSeconds is %s', async (_label, ttl) => {
      const service = new RedisService(makeConfig({}));

      await service.set('k', 'v', ttl);

      expect(lastClient().set).toHaveBeenCalledWith('k', 'v');
    });

    it('del returns 0 without touching Redis when no keys are given', async () => {
      const service = new RedisService(makeConfig({}));

      await expect(service.del()).resolves.toBe(0);
      expect(lastClient().del).not.toHaveBeenCalled();
    });

    it('del forwards all keys and returns the deleted count', async () => {
      const service = new RedisService(makeConfig({}));

      await expect(service.del('a', 'b')).resolves.toBe(2);
      expect(lastClient().del).toHaveBeenCalledWith('a', 'b');
    });
  });

  describe('onModuleDestroy', () => {
    it('quits gracefully', async () => {
      const service = new RedisService(makeConfig({}));

      await service.onModuleDestroy();

      expect(lastClient().quit).toHaveBeenCalledTimes(1);
      expect(lastClient().disconnect).not.toHaveBeenCalled();
    });

    it('falls back to disconnect when quit rejects', async () => {
      const service = new RedisService(makeConfig({}));
      lastClient().quit.mockRejectedValue(new Error('closed'));

      await service.onModuleDestroy();

      expect(lastClient().disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
