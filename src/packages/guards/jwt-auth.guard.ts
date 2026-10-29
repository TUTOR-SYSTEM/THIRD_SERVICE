import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '@packages/decorators';
import { DRIZZLE } from '../../database/database.module';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

import type { JwtUserRole } from '@packages/helpers';
import { resolveJwtAccessSecret } from '../configs/jwt-sign.config';
import { users } from '../../database/schema';
import { RedisService } from '../../features/redis/redis.service';

/** Per-process cache of a successful session check (contract C1: at most 5s stale). */
const SESSION_CACHE_TTL_MS = 5_000;
/** Each Redis session lookup is bounded so a dead Redis cannot hang the request. */
const SESSION_CHECK_TIMEOUT_MS = 2_000;
/** Maximum lookups per request: the first try plus one short retry. */
const SESSION_CHECK_ATTEMPTS = 2;
const SESSION_CACHE_MAX_ENTRIES = 5_000;

/** Access-token payload shape (matches access JWTs from `signAccessToken`). */
export type JwtGuardUser = {
  id: string;
  email: string;
  typ: 'access';
  role: JwtUserRole;
  /** Session id (contract C1). Tokens without it are legacy and rejected. */
  sid: string;
};

type RequestWithUser = Request & { user?: JwtGuardUser };

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization || typeof authorization !== 'string') {
    return undefined;
  }
  const [scheme, value] = authorization.split(' ');
  if (scheme !== 'Bearer' || !value) {
    return undefined;
  }
  return value;
}

const JWT_ROLES: readonly JwtUserRole[] = ['STUDENT', 'ADMIN', 'TUTOR', 'PARENT'];

function parseJwtUserRole(value: unknown): JwtUserRole {
  if (typeof value != 'string') throw new UnauthorizedException('Check role user failed ...');
  if (typeof value === 'string' && (JWT_ROLES as readonly string[]).includes(value)) {
    return value as JwtUserRole;
  }
  return 'STUDENT';
}

function parseAccessPayload(decoded: unknown): JwtGuardUser {
  if (typeof decoded !== 'object' || decoded === null) {
    throw new UnauthorizedException('Unauthorized ...');
  }
  const o = decoded as Record<string, unknown>;
  if (
    o.typ !== 'access' ||
    typeof o.sub !== 'string' ||
    typeof o.email !== 'string' ||
    typeof o.sid !== 'string' ||
    o.sid.length === 0
  ) {
    throw new UnauthorizedException('Unauthorized ...');
  }
  return {
    id: o.sub,
    email: o.email,
    typ: 'access',
    role: parseJwtUserRole(o.role),
    sid: o.sid,
  };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly db: PostgresJsDatabase<Record<string, never>>;
  private readonly logger = new Logger(JwtAuthGuard.name);
  /** `userId:sid` -> expiry (ms) of the last successful session + active-user check. */
  private readonly validSessions = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly drizzleDB: PostgresJsDatabase<Record<string, never>>,
    private readonly redisService: RedisService,
  ) {
    this.db = drizzleDB;
  }

  /**
   * Session must exist in Redis (`session:{userId}:{sid}`, written at login/refresh and removed on
   * logout / password change / deactivation). Fail-closed on Redis errors or timeouts unless
   * `SESSION_CHECK_FAIL_OPEN=true`.
   */
  private async sessionExists(userId: string, sid: string): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SESSION_CHECK_ATTEMPTS; attempt++) {
      try {
        return await this.withTimeout(
          this.redisService.exists(`session:${userId}:${sid}`),
          SESSION_CHECK_TIMEOUT_MS,
        );
      } catch (err) {
        lastError = err;
      }
    }
    if (this.configService.get<string>('SESSION_CHECK_FAIL_OPEN') === 'true') {
      this.logger.warn(
        `Session check unavailable, failing open (SESSION_CHECK_FAIL_OPEN=true): ${(lastError as Error)?.message}`,
      );
      return true;
    }
    this.logger.error(`Session check unavailable: ${(lastError as Error)?.message}`);
    throw new ServiceUnavailableException('Session store unavailable');
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private isCachedValid(cacheKey: string): boolean {
    const expiresAt = this.validSessions.get(cacheKey);
    if (expiresAt === undefined) return false;
    if (expiresAt < Date.now()) {
      this.validSessions.delete(cacheKey);
      return false;
    }
    return true;
  }

  private rememberValid(cacheKey: string): void {
    if (this.validSessions.size >= SESSION_CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [key, expiresAt] of this.validSessions) {
        if (expiresAt < now) this.validSessions.delete(key);
      }
      if (this.validSessions.size >= SESSION_CACHE_MAX_ENTRIES) this.validSessions.clear();
    }
    this.validSessions.set(cacheKey, Date.now() + SESSION_CACHE_TTL_MS);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = bearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Unauthorized ...');
    }

    const accessSecret = resolveJwtAccessSecret(this.configService);

    let decoded: unknown;
    try {
      decoded = this.jwtService.verify(token, {
        secret: accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Unauthorized ...');
    }

    const payload = parseAccessPayload(decoded);
    request.user = payload;

    const cacheKey = `${payload.id}:${payload.sid}`;
    if (this.isCachedValid(cacheKey)) {
      return true;
    }

    if (!(await this.sessionExists(payload.id, payload.sid))) {
      throw new UnauthorizedException('Unauthorized ...');
    }

    const rows = await this.db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, payload.id))
      .limit(1);

    if (rows.length === 0 || !rows[0].isActive) {
      throw new UnauthorizedException('Unauthorized ...');
    }

    this.rememberValid(cacheKey);
    return true;
  }
}
