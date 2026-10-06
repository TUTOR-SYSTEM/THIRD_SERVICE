import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RedisService } from './features/redis/redis.service';

@ApiTags('Health')
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  constructor(
    private readonly appService: AppService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check', description: 'Returns a simple health check response' })
  @SwaggerResponse({
    status: 200,
    description: 'Server is running',
    schema: { type: 'string', example: 'Hello World!' },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @MessagePattern('health.redis')
  async checkRedisHealth(@Payload() payload?: { fetchData?: boolean }): Promise<unknown> {
    this.logger.log('[HEALTH] Checking Redis connection and cache data');
    try {
      const shouldFetchData = payload?.fetchData ?? false;
      const client = this.redisService.client;
      const [pong, info, dbsize] = await Promise.all([
        client.ping(),
        client.info('memory'),
        client.dbsize(),
      ]);

      const stats: Record<string, unknown> = {
        status: 'healthy',
        cache: 'Redis',
        connection: 'connected',
        timestamp: new Date().toISOString(),
        message: 'Redis connection is healthy',
        ping: pong,
        stats: {
          totalKeys: dbsize,
          info: info.split('\r\n').slice(0, 5).join(', '), // Sample of info
        },
      };

      if (shouldFetchData) {
        // SCAN (not KEYS) so a large keyspace never blocks Redis; first 10 keys only.
        const [, sampleKeys] = await client.scan(0, 'COUNT', 100);
        const keys = sampleKeys.slice(0, 10);
        if (keys.length > 0) {
          const values = await client.mget(keys);
          stats['sampleKeys'] = Object.fromEntries(keys.map((k, i) => [k, values[i] ?? null]));
        }
      }

      this.logger.log('[HEALTH] Redis connection OK, cache data retrieved');
      return stats;
    } catch (error) {
      this.logger.error(`[HEALTH] Redis connection failed: ${error}`);
      return {
        status: 'unhealthy',
        cache: 'Redis',
        connection: 'failed',
        timestamp: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'Redis connection failed',
      };
    }
  }
}
