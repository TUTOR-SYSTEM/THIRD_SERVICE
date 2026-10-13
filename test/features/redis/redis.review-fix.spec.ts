import { RedisService } from 'src/features/redis/redis.service';

const created: Array<unknown[]> = [];
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation((...args: unknown[]) => {
    created.push(args);
    return { on: jest.fn(), connect: jest.fn(), status: 'wait' };
  }),
}));

// F-14
describe('RedisService options (review-fix F-14)', () => {
  it.each([
    [{ REDIS_URL: 'redis://x:6379' }, 1],
    [{ REDIS_HOST: 'h' }, 0],
  ])('does not use maxRetriesPerRequest: null (%j)', (values) => {
    created.length = 0;
    new RedisService({ get: (k: string) => (values as any)[k] } as any);
    const opts = created[0].find((a) => typeof a === 'object') as any;
    expect(opts.maxRetriesPerRequest).not.toBeNull();
  });
});
