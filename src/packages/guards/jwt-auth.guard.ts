import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
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
import { users } from '../../database/schema';

/** Access-token payload shape (matches access JWTs from `signAccessToken`). */
export type JwtGuardUser = {
  id: string;
  email: string;
  typ: 'access';
  role: JwtUserRole;
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
  if (o.typ !== 'access' || typeof o.sub !== 'string' || typeof o.email !== 'string') {
    throw new UnauthorizedException('Unauthorized ...');
  }
  return { id: o.sub, email: o.email, typ: 'access', role: parseJwtUserRole(o.role) };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly db: PostgresJsDatabase<Record<string, never>>;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly drizzleDB: PostgresJsDatabase<Record<string, never>>,
  ) {
    this.db = drizzleDB;
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

    const accessSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ??
      this.configService.get<string>('JWT_SECRET') ??
      'dev-insecure-jwt-secret';

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

    const user = await this.db.select().from(users).where(eq(users.id, payload.id)).limit(1);

    if (user.length === 0) {
      throw new UnauthorizedException('Unauthorized ...');
    }

    return true;
  }
}
