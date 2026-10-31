import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles } from '@packages/decorators';
import { RolesGuard } from '@packages/guards';
import { RedisService } from './redis.service';

/** Key prefixes holding sessions / refresh / reset tokens — never readable over HTTP. */
const SENSITIVE_KEY_PREFIXES = [
  'session:',
  'login-session:',
  'reset-password:',
  'refresh:',
  'refresh-token:',
];

@ApiTags('Redis')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles('ADMIN')
@Controller('redis')
export class RedisController {
  constructor(private readonly redisService: RedisService) {}

  @Get('get')
  @ApiOperation({ summary: 'Get Redis value', description: 'Retrieve a value from Redis by key' })
  @ApiQuery({ name: 'key', required: true, type: String, description: 'Redis key' })
  @SwaggerResponse({ status: 200, description: 'Value retrieved (null if key does not exist)' })
  async get(@Query('key') key: string): Promise<string | null> {
    const lowered = (key ?? '').toLowerCase();
    if (SENSITIVE_KEY_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
      throw new ForbiddenException('Access to this Redis key is not allowed');
    }
    return this.redisService.get(key);
  }
}
