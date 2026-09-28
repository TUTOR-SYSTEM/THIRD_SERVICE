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
import { requestLogs, users } from '@tutor/gateway/schema';

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
  cors: { origin: true, credentials: true },
  namespace: '/logs',
})
export class LogGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<Record<string, never>>,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token: unknown =
        client.handshake.auth?.token ??
        (client.handshake.headers?.authorization)?.replace('Bearer ', '');

      if (!token || typeof token !== 'string') {
        client.disconnect();
        return;
      }

      const accessSecret =
        this.configService.get<string>('JWT_ACCESS_SECRET') ??
        this.configService.get<string>('JWT_SECRET') ??
        'dev-insecure-jwt-secret';

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
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(): void {
    // No per-connection state to clean up — unlike ChatGateway there's no online-user roster.
  }

  /** Broadcast one freshly-inserted `request_logs` row to every connected admin viewer. */
  emitNewLog(row: RequestLogRow): void {
    this.server?.emit('log:new', row);
  }
}
