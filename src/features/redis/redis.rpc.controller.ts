import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { RedisService } from './redis.service';

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

  // Request-reply so callers can wait for the write to land (e.g. the reset-password token must
  // exist before the email goes out). The reply must be non-undefined or the RMQ client
  // completes empty and `RmqProducer.send()` treats it as a failure.
  @MessagePattern('redis.set')
  async set(@Payload() payload: { key: string; value: string; ttlSeconds?: number }) {
    await this.redisService.set(payload.key, payload.value, payload.ttlSeconds);
    return { ok: true };
  }

  @EventPattern('redis.del')
  del(@Payload() payload: { keys: string[] }) {
    return this.redisService.del(...payload.keys);
  }
}
