import { Inject, Injectable } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Server, Socket } from 'socket.io';
import { DRIZZLE } from '../../database/database.module';
import { resolveJwtAccessSecret } from '../../packages/configs/jwt-sign.config';
import { requestLogs, users } from '../../database/schema';
import { resolveCorsOrigins } from '../../packages/helpers/cors.helper';

type RequestLogRow = typeof requestLogs.$inferSelect;

type AuthenticatedSocket = Socket & {
  userId?: string;
  userRole?: string;
};

/**
 * Admin-only live feed of new `request_logs` rows — `LogService.createInternal()` calls
 * `emitNewLog()` right after each successful insert so the "Giám sát Request" admin page can
 * stream new requests without polling. Auth mirrors tutor-service's `ChatGateway` (JWT in
 * handshake, verified with the same access secret as `JwtAuthGuard`) but additionally requires
 * `role === 'ADMIN'` since every viewer here can see every other user's request traffic.
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: resolveCorsOrigins(), credentials: true },
  namespace: '/logs',
})
export class LogGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<Record<string, never>>,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token: unknown =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token || typeof token !== 'string') {
        client.disconnect();
        return;
      }

      const accessSecret = resolveJwtAccessSecret(this.configService);

      const decoded: unknown = this.jwtService.verify(token, { secret: accessSecret });
      if (
        typeof decoded !== 'object' ||
        decoded === null ||
        (decoded as Record<string, unknown>).typ !== 'access' ||
        (decoded as Record<string, unknown>).role !== 'ADMIN' ||
        typeof (decoded as Record<string, unknown>).sub !== 'string'
      ) {
        client.disconnect();
        return;
      }

      const userId = (decoded as Record<string, string>).sub;
      const user = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (user.length === 0) {
        client.disconnect();
        return;
      }

      client.userId = userId;
      client.userRole = 'ADMIN';
      await client.join('admins');

      // Drop the socket once its access token expires.
      const exp = (decoded as Record<string, unknown>).exp;
      if (typeof exp === 'number') {
        const ms = Math.max(0, exp * 1000 - Date.now());
        const timer = setTimeout(() => client.disconnect(), ms);
        timer.unref?.();
        this.expiryTimers.set(client.id, timer);
      }
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client?: AuthenticatedSocket): void {
    const timer = client?.id ? this.expiryTimers.get(client.id) : undefined;
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(client!.id);
    }
  }

  /** Broadcast one freshly-inserted `request_logs` row to the `admins` room (authenticated admins only). */
  emitNewLog(row: RequestLogRow): void {
    this.server?.to('admins').emit('log:new', row);
  }
}
