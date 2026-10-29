import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';

/** Tùy chọn chung: lazyConnect + offline queue cho phép lệnh đầu chờ kết nối (tránh "Stream isn't writeable"). */
const connectionOptions = {
  lazyConnect: true,
  connectTimeout: 10_000,
  /** true (mặc định ioredis): lệnh chờ socket ready; false + lazyConnect dễ lỗi trước khi connect xong */
  enableOfflineQueue: true,
  /** Hữu hạn (không null) để lệnh fail nhanh khi Redis down thay vì treo vô hạn */
  maxRetriesPerRequest: 3,
  /** Rejects a command (even one parked in the offline queue) after 5s so a dead Redis can't hang callers. */
  commandTimeout: 5_000,
} as const satisfies Pick<
  RedisOptions,
  | 'lazyConnect'
  | 'connectTimeout'
  | 'enableOfflineQueue'
  | 'maxRetriesPerRequest'
  | 'commandTimeout'
>;

/**
 * Only the per-user session / refresh key families may be bulk-deleted (contract C1):
 * `session:<uuid>:` and `refresh:<uuid>:`. Anything else is rejected, so `delByPrefix('')` or
 * `delByPrefix('*')` can never wipe unrelated data.
 */
export const DELETABLE_PREFIX_PATTERN =
  /^(session|refresh):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:$/i;

const SCAN_BATCH = 200;

const INCR_WITH_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly endpointLabel: string;
  readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('REDIS_URL')?.trim();

    if (url && url.length > 0) {
      this.endpointLabel = 'REDIS_URL';
      this.client = new Redis(url, { ...connectionOptions });
    } else {
      const host = this.configService.get<string>('REDIS_HOST')?.trim() || 'localhost';
      const port = Number(this.configService.get<string>('REDIS_PORT')?.trim() || '6379');
      const password = this.configService.get<string>('REDIS_PASSWORD')?.trim();
      this.endpointLabel = `${host}:${Number.isFinite(port) ? port : 6380}`;
      const opts: RedisOptions = {
        ...connectionOptions,
        host,
        port: Number.isFinite(port) ? port : 6380,
        password: password && password.length > 0 ? password : undefined,
      };
      this.client = new Redis(opts);
    }

    this.client.on('error', (err: Error) => {
      this.logger.warn(
        `Redis (${this.endpointLabel}): ${err.message} — kiểm tra Redis đang chạy và REDIS_HOST/REDIS_PORT/REDIS_URL (compose mặc định map cổng host 6380).`,
      );
    });

    this.client.on('connect', () => {
      this.logger.log(`✅ Redis connected (${this.endpointLabel})`);
    });

    this.client.on('ready', () => {
      this.logger.log(`✅ Redis ready (${this.endpointLabel})`);
    });
  }

  /**
   * `lazyConnect: true` means ioredis never opens the socket until the first command runs —
   * without this, 'connect'/'ready' never fire at boot and the app looks "connected" (no error)
   * while actually not talking to Redis until some request happens to touch it. Triggering the
   * connect explicitly here surfaces success/failure at startup, same as DatabaseModule's
   * `SELECT 1` check. Not thrown on failure — Redis consumers such as
   * TokenBucketGuard fail open and ioredis keeps retrying against the same client in the
   * background, still logged by the 'error'/'connect'/'ready' listeners above.
   */
  async onModuleInit(): Promise<void> {
    // This hybrid app (HTTP + RMQ microservice) runs Nest's module lifecycle twice for a
    // `@Global()` provider like this one — guard on ioredis's own state so the 2nd pass is a
    // silent no-op instead of a confusing "already connecting/connected" warning.
    if (this.client.status !== 'wait') {
      return;
    }
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.warn(
        `Initial Redis connect failed (${this.endpointLabel}): ${(error as Error).message} — will keep retrying in the background.`,
      );
    }
  }

  async get(key: string): Promise<string | null> {
    if (typeof key !== 'string' || key.length === 0) {
      throw new BadRequestException('key is required');
    }
    return await this.client.get(key);
  }

  async exists(key: string): Promise<boolean> {
    if (typeof key !== 'string' || key.length === 0) {
      throw new BadRequestException('key is required');
    }
    return (await this.client.exists(key)) > 0;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (typeof key !== 'string' || key.length === 0) {
      throw new BadRequestException('key is required');
    }
    if (typeof value !== 'string') {
      throw new BadRequestException('value must be a string');
    }
    if (ttlSeconds === undefined || ttlSeconds === null) {
      await this.client.set(key, value);
      return;
    }
    // A bad TTL (0, negative, "300") used to fall through to a key that never expires —
    // dangerous for session / reset-password tokens.
    if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new BadRequestException('ttlSeconds must be a positive number');
    }
    await this.client.set(key, value, 'EX', Math.ceil(ttlSeconds));
  }

  /**
   * Deletes every key starting with an allowed `session:<uuid>:` / `refresh:<uuid>:` prefix.
   * Uses SCAN (never KEYS) so it does not block Redis. Returns the number of keys deleted.
   */
  async delByPrefix(prefix: string): Promise<number> {
    if (typeof prefix !== 'string' || !DELETABLE_PREFIX_PATTERN.test(prefix)) {
      throw new BadRequestException('prefix is not allowed');
    }
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        SCAN_BATCH,
      );
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');
    return deleted;
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return await this.client.del(...keys);
  }

  /**
   * Atomic read-and-delete (GETDEL): returns the value and removes the key in one step, so two
   * concurrent callers can never both read the same single-use token.
   */
  async getdel(key: string): Promise<string | null> {
    if (typeof key !== 'string' || key.length === 0) {
      throw new BadRequestException('key is required');
    }
    return await this.client.getdel(key);
  }

  /**
   * Atomic counter with a fixed window: INCR, and EXPIRE only when this call created the key.
   * Done in one Lua script so a crash between the two commands can never leave a counter without
   * a TTL. Returns the count after this increment.
   */
  async incrWithWindow(key: string, windowSeconds: number): Promise<number> {
    if (typeof key !== 'string' || key.length === 0) {
      throw new BadRequestException('key is required');
    }
    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
      throw new BadRequestException('windowSeconds must be a positive integer');
    }
    const count = await this.client.eval(INCR_WITH_WINDOW_SCRIPT, 1, key, windowSeconds);
    return Number(count);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
