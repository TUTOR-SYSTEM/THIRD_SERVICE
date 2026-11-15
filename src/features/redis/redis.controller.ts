import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  NotFoundException,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBody,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Public } from '@packages/decorators';
import { ZodValidationPipe } from '@packages/pipes';
import { z } from 'zod';
import { DELETABLE_PREFIX_PATTERN, RedisService } from './redis.service';

/** Key prefixes holding sessions / refresh / reset tokens — never reachable over HTTP. */
const SENSITIVE_KEY_PREFIXES = [
  'session:',
  'login-session:',
  'reset-password:',
  // Password-reset code hashes and their attempt counters (no colon: covers both key shapes).
  'reset-password-otp',
  'refresh:',
  'refresh-token:',
];

const keySchema = z.object({
  key: z.string({ message: 'key is required' }).min(1, 'key is required').max(256),
});

const setSchema = z.object({
  key: z.string({ message: 'key is required' }).min(1, 'key is required').max(256),
  value: z.string({ message: 'value must be a string' }),
  ttlSeconds: z
    .number({ message: 'ttlSeconds must be a positive integer' })
    .int('ttlSeconds must be a positive integer')
    .positive('ttlSeconds must be a positive integer')
    .optional(),
});

const delSchema = z.object({
  keys: z
    .array(z.string().min(1, 'keys must be non-empty strings'), { message: 'keys is required' })
    .min(1, 'keys is required'),
});

const delByPrefixSchema = z.object({
  prefix: z
    .string({ message: 'prefix is required' })
    .regex(DELETABLE_PREFIX_PATTERN, 'prefix must be session:<uuid>: or refresh:<uuid>:'),
});

const incrSchema = z.object({
  key: z.string({ message: 'key is required' }).min(1, 'key is required').max(256),
  windowSeconds: z
    .number({ message: 'windowSeconds must be a positive integer' })
    .int('windowSeconds must be a positive integer')
    .positive('windowSeconds must be a positive integer'),
});

type KeyDto = z.infer<typeof keySchema>;
type SetDto = z.infer<typeof setSchema>;
type DelDto = z.infer<typeof delSchema>;
type DelByPrefixDto = z.infer<typeof delByPrefixSchema>;
type IncrDto = z.infer<typeof incrSchema>;

/**
 * HTTP mirror of `RedisRpcController` (same `<feature>/<rpcMethod>` route names). Every route
 * delegates to the unmodified `RedisService`. Any key (or prefix) in a sensitive family is refused
 * with 403 on every route, so sessions, refresh tokens and reset tokens cannot be read, written,
 * consumed or bulk-deleted over HTTP.
 */
@ApiTags('Redis')
@ApiBearerAuth('access-token')
@Public()
@Controller('redis')
export class RedisController {
  constructor(private readonly redisService: RedisService) {}

  @Get('get')
  @ApiOperation({ summary: 'Get Redis value', description: 'Retrieve a value from Redis by key' })
  @ApiQuery({ name: 'key', required: true, type: String, description: 'Redis key' })
  @SwaggerResponse({ status: 200, description: 'Value retrieved (null if key does not exist)' })
  @SwaggerResponse({ status: 403, description: 'Sensitive key family' })
  async get(@Query('key') key: string): Promise<string | null> {
    this.assertNotSensitive([key ?? '']);
    return this.redisService.get(key);
  }

  @Get('exists')
  @ApiOperation({
    summary: 'Check Redis key exists',
    description: 'Existence only, never the value',
  })
  @ApiQuery({ name: 'key', required: true, type: String })
  @SwaggerResponse({ status: 200, description: 'true if the key exists' })
  @SwaggerResponse({ status: 403, description: 'Sensitive key family' })
  async exists(@Query(new ZodValidationPipe<KeyDto>(keySchema)) { key }: KeyDto) {
    this.assertNotSensitive([key]);
    return this.redisService.exists(key);
  }

  @Get('ttl')
  @ApiOperation({
    summary: 'Get remaining TTL',
    description: 'Seconds left (-1 = no expiry, -2 = missing)',
  })
  @ApiQuery({ name: 'key', required: true, type: String })
  @SwaggerResponse({ status: 200, description: 'Remaining TTL in seconds' })
  @SwaggerResponse({ status: 403, description: 'Sensitive key family' })
  async ttl(@Query(new ZodValidationPipe<KeyDto>(keySchema)) { key }: KeyDto) {
    this.assertNotSensitive([key]);
    return this.redisService.ttl(key);
  }

  @Post('set')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set Redis value', description: 'Write a string value, optional TTL' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
        ttlSeconds: { type: 'integer', minimum: 1 },
      },
    },
  })
  @SwaggerResponse({ status: 200, description: 'Value stored' })
  @SwaggerResponse({ status: 403, description: 'Sensitive key family' })
  async set(@Body(new ZodValidationPipe<SetDto>(setSchema)) body: SetDto) {
    this.assertNotSensitive([body.key]);
    await this.redisService.set(body.key, body.value, body.ttlSeconds);
    return { ok: true };
  }

  @Post('getdel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get and delete Redis value',
    description: 'Atomic read-and-delete (single-use values)',
  })
  @ApiBody({
    schema: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } },
  })
  @SwaggerResponse({ status: 200, description: 'Value returned and key deleted' })
  @SwaggerResponse({ status: 404, description: 'Key does not exist (or already consumed)' })
  @SwaggerResponse({ status: 403, description: 'Sensitive key family' })
  async getdel(@Body(new ZodValidationPipe<KeyDto>(keySchema)) { key }: KeyDto) {
    this.assertNotSensitive([key]);
    const value = await this.redisService.getdel(key);
    if (value === null) throw new NotFoundException('Redis key not found');
    return value;
  }

  @Post('incr')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Increment fixed-window counter',
    description: 'Returns the count after this increment; window starts when the key is created',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['key', 'windowSeconds'],
      properties: {
        key: { type: 'string' },
        windowSeconds: { type: 'integer', minimum: 1 },
      },
    },
  })
  @SwaggerResponse({ status: 200, description: 'Count after increment' })
  @SwaggerResponse({ status: 403, description: 'Sensitive key family' })
  async incr(@Body(new ZodValidationPipe<IncrDto>(incrSchema)) body: IncrDto) {
    this.assertNotSensitive([body.key]);
    const count = await this.redisService.incrWithWindow(body.key, body.windowSeconds);
    return { count };
  }

  @Delete('del')
  @ApiOperation({ summary: 'Delete Redis keys', description: 'Delete one or more keys' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['keys'],
      properties: { keys: { type: 'array', items: { type: 'string' }, minItems: 1 } },
    },
  })
  @SwaggerResponse({ status: 200, description: 'Number of keys deleted' })
  @SwaggerResponse({ status: 403, description: 'Sensitive key family' })
  async del(@Body(new ZodValidationPipe<DelDto>(delSchema)) body: DelDto) {
    this.assertNotSensitive(body.keys);
    const deleted = await this.redisService.del(...body.keys);
    return { deleted };
  }

  @Delete('delByPrefix')
  @ApiOperation({
    summary: 'Delete keys by prefix',
    description:
      'Only session:<uuid>: / refresh:<uuid>: prefixes (both are sensitive, so refused here)',
  })
  @ApiBody({
    schema: { type: 'object', required: ['prefix'], properties: { prefix: { type: 'string' } } },
  })
  @SwaggerResponse({ status: 200, description: 'Number of keys deleted' })
  @SwaggerResponse({ status: 403, description: 'Sensitive key family' })
  async delByPrefix(
    @Body(new ZodValidationPipe<DelByPrefixDto>(delByPrefixSchema)) body: DelByPrefixDto,
  ) {
    this.assertNotSensitive([body.prefix]);
    const deleted = await this.redisService.delByPrefix(body.prefix);
    return { deleted };
  }

  private assertNotSensitive(keys: string[]): void {
    for (const key of keys) {
      const lowered = key.toLowerCase();
      if (SENSITIVE_KEY_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
        throw new ForbiddenException('Access to this Redis key is not allowed');
      }
    }
  }
}
