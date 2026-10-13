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
  async checkRedisHealth(@Payload() _payload?: { fetchData?: boolean }): Promise<unknown> {
    this.logger.log('[HEALTH] Checking Redis connection');
    try {
      const client = this.redisService.client;
      const [pong, info, dbsize] = await Promise.all([
        client.ping(),
        client.info('memory'),
        client.dbsize(),
      ]);

      // Never return key names or values — counts and memory info only.
      return {
        status: 'healthy',
        cache: 'Redis',
        connection: 'connected',
        timestamp: new Date().toISOString(),
        message: 'Redis connection is healthy',
        ping: pong,
        stats: {
          totalKeys: dbsize,
          info: info.split('\r\n').slice(0, 5).join(', '),
        },
      };
    } catch (error) {
      this.logger.error(`[HEALTH] Redis connection failed: ${error}`);
      return {
        status: 'unhealthy',
        cache: 'Redis',
        connection: 'failed',
        timestamp: new Date().toISOString(),
        message: 'Redis unavailable',
      };
    }
  }
}
