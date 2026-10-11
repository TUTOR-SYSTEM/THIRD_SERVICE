import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { RedisService } from '../../features/redis/redis.service';
import { THROTTLE_KEY, type ThrottleOptions } from '@packages/decorators';

const DEFAULT_THROTTLE: ThrottleOptions = { limit: 60, ttl: 60 };

@Injectable()
export class TokenBucketGuard implements CanActivate {
  private readonly client: Redis;
  private readonly logger = new Logger(TokenBucketGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {
    this.client = redisService.client;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options =
      this.reflector.getAllAndOverride<ThrottleOptions>(THROTTLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_THROTTLE;

    const request = context.switchToHttp().getRequest<Request>();
    const key = this.buildKey(request);
    const now = Math.floor(Date.now() / 1000);
    const maxTokens = options.limit;
    const refillPerSecond = maxTokens / options.ttl;

    let bucket: number[];
    try {
      bucket = await this.evalBucket(key, maxTokens, refillPerSecond, now);
    } catch (err) {
      // Redis unreachable / timed out: rate limiting is best-effort, don't take every route down with it.
      this.logger.warn(`Rate limiter unavailable, failing open: ${(err as Error).message}`);
      return true;
    }
    const [allowed, remaining, limit, retryAfter] = bucket;

    request.res?.setHeader('X-RateLimit-Limit', limit);
    request.res?.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
    if (retryAfter > 0) {
      request.res?.setHeader('Retry-After', retryAfter);
    }

    if (allowed === 0) {
      throw new HttpException('TOO_MANY_REQUESTS', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private buildKey(request: Request): string {
    const user = (request as unknown as Record<string, unknown>).user as
      { id?: string } | undefined;
    const identifier = user?.id ?? request.ip ?? 'anonymous';
    // Route pattern (e.g. /notifications/:id), not the raw path, so random ids can't dodge the
    // limit or create unbounded Redis keys.
    const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
    return `ratelimit:${identifier}:${request.method}:${routePath}`;
  }

  private async evalBucket(
    key: string,
    maxTokens: number,
    refillPerSecond: number,
    now: number,
  ): Promise<number[]> {
    const script = `
      local tokens, lastRefill = unpack(redis.call('HMGET', KEYS[1], 'tokens', 'lastRefill'))
      local maxTokens = tonumber(ARGV[1])
      local refillPerSecond = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])

      if tokens == false then
        redis.call('HMSET', KEYS[1], 'tokens', maxTokens - 1, 'lastRefill', now)
        redis.call('EXPIRE', KEYS[1], math.ceil(maxTokens / math.max(refillPerSecond, 0.001)) + 10)
        return {1, maxTokens - 1, maxTokens, 0}
      end

      tokens = tonumber(tokens)
      lastRefill = tonumber(lastRefill)
      local elapsed = math.max(0, now - lastRefill)
      tokens = math.min(tokens + elapsed * refillPerSecond, maxTokens)

      if tokens < 1 then
        local wait = math.ceil((1 - tokens) / math.max(refillPerSecond, 0.001))
        return {0, 0, maxTokens, wait}
      end

      tokens = tokens - 1
      redis.call('HMSET', KEYS[1], 'tokens', tokens, 'lastRefill', now)
      redis.call('EXPIRE', KEYS[1], math.ceil(maxTokens / math.max(refillPerSecond, 0.001)) + 10)
      return {1, math.floor(tokens), maxTokens, 0}
    `;

    const result = await this.client.eval(
      script,
      1,
      key,
      String(maxTokens),
      String(refillPerSecond),
      String(now),
    );

    return result as number[];
  }
}
