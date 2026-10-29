import { BadRequestException, Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { DELETABLE_PREFIX_PATTERN, RedisService } from './redis.service';

/** Key families that hold sessions / refresh hashes / reset tokens: must always carry a TTL. */
const TTL_REQUIRED_PREFIXES = [
  'session:',
  'login-session:',
  'reset-password:',
  'refresh:',
  'refresh-token:',
];

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

/**
 * Message-pattern mirror of `RedisController` — reached by the gateway's/`user`'s
 * `RmqProducer` over the `third_queue` RabbitMQ queue. Delegates to
 * the same, unmodified `RedisService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class RedisRpcController {
  constructor(private readonly redisService: RedisService) {}

  @MessagePattern('redis.get')
  get(@Payload() payload: { key: string }) {
    return this.redisService.get(payload.key);
  }

  // Existence only (never the value) — used by the gateway's session check.
  @MessagePattern('redis.exists')
  exists(@Payload() payload: { key: string }) {
    return this.redisService.exists(payload.key);
  }

  // Atomic read-and-delete for single-use tokens (reset-password): only one caller gets the value.
  @MessagePattern('redis.getdel')
  getdel(@Payload() payload?: { key: string }) {
    return this.redisService.getdel(payload?.key as string);
  }

  /**
   * Atomic fixed-window counter (e.g. failed-login attempts per account). Replies with the count
   * after this increment; the window starts when the key is first created.
   */
  @MessagePattern('redis.incr')
  async incr(@Payload() payload: unknown) {
    const parsed = incrSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const count = await this.redisService.incrWithWindow(
      parsed.data.key,
      parsed.data.windowSeconds,
    );
    return { count };
  }

  // Request-reply so callers can wait for the write to land (e.g. the reset-password token must
  // exist before the email goes out). The reply must be non-undefined or the RMQ client
  // completes empty and `RmqProducer.send()` treats it as a failure.
  @MessagePattern('redis.set')
  async set(@Payload() payload: { key: string; value: string; ttlSeconds?: number }) {
    const lowered = String(payload?.key ?? '').toLowerCase();
    if (
      (payload?.ttlSeconds === undefined || payload?.ttlSeconds === null) &&
      TTL_REQUIRED_PREFIXES.some((prefix) => lowered.startsWith(prefix))
    ) {
      // A session / refresh / reset key without TTL would never expire.
      throw new BadRequestException('ttlSeconds is required for this key');
    }
    await this.redisService.set(payload.key, payload.value, payload.ttlSeconds);
    return { ok: true };
  }

  /**
   * Bulk revoke for contract C1 (`session:{userId}:` / `refresh:{userId}:`). Scans with SCAN.
   * Replies `{ deleted }` (never empty, so `RmqProducer.send()` treats it as success).
   */
  @MessagePattern('redis.delByPrefix')
  async delByPrefix(@Payload() payload: unknown) {
    const parsed = delByPrefixSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const deleted = await this.redisService.delByPrefix(parsed.data.prefix);
    return { deleted };
  }

  @EventPattern('redis.del')
  del(@Payload() payload: { keys: string[] }) {
    if (!Array.isArray(payload?.keys) || payload.keys.some((k) => typeof k !== 'string' || !k)) {
      throw new BadRequestException('keys must be an array of non-empty strings');
    }
    return this.redisService.del(...payload.keys);
  }
}
