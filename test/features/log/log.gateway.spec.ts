import { LogGateway } from 'src/features/log/log.gateway';

type FakeClient = {
  handshake: { auth?: Record<string, unknown>; headers?: Record<string, string> };
  disconnect: jest.Mock;
  userId?: string;
  userRole?: string;
};

const client = (over: Partial<FakeClient['handshake']> = {}): FakeClient => ({
  handshake: { auth: {}, headers: {}, ...over },
  disconnect: jest.fn(),
});

/** drizzle stand-in: `select().from().where().limit()` resolves to `rows`. */
const dbReturning = (rows: unknown[]) => {
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  return { db: { select: jest.fn(() => ({ from })) }, limit, where };
};

describe('LogGateway', () => {
  const verify = jest.fn();
  const jwtService = { verify } as never;
  let config: Record<string, string | undefined>;
  const configService = { get: jest.fn((key: string) => config[key]) } as never;

  const adminPayload = { sub: 'admin-1', role: 'ADMIN', typ: 'access' };

  beforeEach(() => {
    jest.clearAllMocks();
    config = { JWT_ACCESS_SECRET: 'access-secret' };
    verify.mockReturnValue(adminPayload);
  });

  const build = (rows: unknown[] = [{ id: 'admin-1' }]) => {
    const { db } = dbReturning(rows);
    return { gateway: new LogGateway(jwtService, configService, db as never), db };
  };

  describe('handleConnection', () => {
    it('disconnects when no token is sent in the handshake auth or headers', async () => {
      const { gateway } = build();
      const socket = client();
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(verify).not.toHaveBeenCalled();
    });

    it('disconnects when the token is not a string', async () => {
      const { gateway } = build();
      const socket = client({ auth: { token: 12345 } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(verify).not.toHaveBeenCalled();
    });

    it('reads the token from handshake.auth first', async () => {
      const { gateway } = build();
      const socket = client({
        auth: { token: 'from-auth' },
        headers: { authorization: 'Bearer from-header' },
      });
      await gateway.handleConnection(socket as never);
      expect(verify).toHaveBeenCalledWith('from-auth', { secret: 'access-secret' });
    });

    it('falls back to the Bearer token in the authorization header', async () => {
      const { gateway } = build();
      const socket = client({ headers: { authorization: 'Bearer from-header' } });
      await gateway.handleConnection(socket as never);
      expect(verify).toHaveBeenCalledWith('from-header', { secret: 'access-secret' });
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('accepts an admin access token and records the user on the socket', async () => {
      const { gateway } = build();
      const socket = client({ auth: { token: 'ok' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.userId).toBe('admin-1');
      expect(socket.userRole).toBe('ADMIN');
    });

    it('uses JWT_SECRET when JWT_ACCESS_SECRET is missing', async () => {
      config = { JWT_SECRET: 'legacy-secret' };
      const { gateway } = build();
      await gateway.handleConnection(client({ auth: { token: 't' } }) as never);
      expect(verify).toHaveBeenCalledWith('t', { secret: 'legacy-secret' });
    });

    it('refuses the connection (no built-in fallback secret) when no secret is configured', async () => {
      config = {};
      const { gateway } = build();
      const socket = client({ auth: { token: 't' } });
      await gateway.handleConnection(socket as never);
      expect(verify).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it.each([
      ['a refresh token (typ not access)', { ...adminPayload, typ: 'refresh' }],
      ['a non-admin role', { ...adminPayload, role: 'TUTOR' }],
      ['a STUDENT role', { ...adminPayload, role: 'STUDENT' }],
      ['a missing sub', { role: 'ADMIN', typ: 'access' }],
      ['a numeric sub', { ...adminPayload, sub: 42 }],
    ])('disconnects for %s', async (_label, payload) => {
      verify.mockReturnValue(payload);
      const { gateway, db } = build();
      const socket = client({ auth: { token: 't' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(socket.userId).toBeUndefined();
      expect(db.select).not.toHaveBeenCalled();
    });

    it('disconnects when the decoded payload is not an object', async () => {
      verify.mockReturnValue('just-a-string');
      const { gateway } = build();
      const socket = client({ auth: { token: 't' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects when the decoded payload is null', async () => {
      verify.mockReturnValue(null);
      const { gateway } = build();
      const socket = client({ auth: { token: 't' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects when the admin no longer exists in the users table', async () => {
      const { gateway, db } = build([]);
      const socket = client({ auth: { token: 't' } });
      await gateway.handleConnection(socket as never);
      expect(db.select).toHaveBeenCalledTimes(1);
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(socket.userId).toBeUndefined();
    });

    it('looks the user up by the sub claim', async () => {
      const { gateway, where, limit } = (() => {
        const r = dbReturning([{ id: 'admin-1' }]);
        return { ...r, gateway: new LogGateway(jwtService, configService, r.db as never) };
      })();
      await gateway.handleConnection(client({ auth: { token: 't' } }) as never);
      expect(where).toHaveBeenCalledTimes(1);
      expect(limit).toHaveBeenCalledWith(1);
    });

    it('disconnects (and does not throw) when jwt verification throws', async () => {
      verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const { gateway } = build();
      const socket = client({ auth: { token: 't' } });
      await expect(gateway.handleConnection(socket as never)).resolves.toBeUndefined();
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects (and does not throw) when the database lookup fails', async () => {
      const limit = jest.fn().mockRejectedValue(new Error('db down'));
      const db = {
        select: jest.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })),
      };
      const gateway = new LogGateway(jwtService, configService, db as never);
      const socket = client({ auth: { token: 't' } });
      await expect(gateway.handleConnection(socket as never)).resolves.toBeUndefined();
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(socket.userId).toBeUndefined();
    });
  });

  describe('handleDisconnect', () => {
    it('is a no-op', () => {
      const { gateway } = build();
      expect(() => gateway.handleDisconnect()).not.toThrow();
    });
  });

  describe('emitNewLog', () => {
    it('broadcasts the row as log:new to every connected viewer', () => {
      const { gateway } = build();
      const emit = jest.fn();
      gateway.server = { emit } as never;
      const row = { id: 'l1', path: '/classes' } as never;

      gateway.emitNewLog(row);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('log:new', row);
    });

    it('does nothing when the websocket server is not initialised yet', () => {
      const { gateway } = build();
      expect(() => gateway.emitNewLog({ id: 'l1' } as never)).not.toThrow();
    });
  });
});
