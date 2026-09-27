import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';

/** Tùy chọn chung: lazyConnect + offline queue cho phép lệnh đầu chờ kết nối (tránh "Stream isn't writeable"). */
const connectionOptions = {
  lazyConnect: true,
  connectTimeout: 10_000,
  /** true (mặc định ioredis): lệnh chờ socket ready; false + lazyConnect dễ lỗi trước khi connect xong */
  enableOfflineQueue: true,
  /** Giảm MaxRetriesPerRequestError khi đang reconnect so với mặc định 3 */
  maxRetriesPerRequest: null,
} as const satisfies Pick<
  RedisOptions,
  'lazyConnect' | 'connectTimeout' | 'enableOfflineQueue' | 'maxRetriesPerRequest'
>;

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
      const port = Number(this.configService.get<string>('REDIS_PORT')?.trim() || '6380');
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
   * `SELECT 1` check. Not thrown on failure — Redis is fails-open elsewhere (see
   * JwtAuthGuard's session check) and ioredis keeps retrying against the same client in the
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
    return await this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return await this.client.del(...keys);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
