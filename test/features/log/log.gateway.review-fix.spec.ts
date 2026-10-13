import { LogGateway } from 'src/features/log/log.gateway';

const mk = (verifyResult: unknown, config: Record<string, string | undefined>) => {
  const verify = jest.fn().mockReturnValue(verifyResult);
  const limit = jest.fn(async () => [{ id: 'admin-1' }]);
  const db = { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) };
  const gateway = new LogGateway(
    { verify } as any,
    { get: jest.fn((k: string) => config[k]) } as any,
    db as any,
  );
  const client: any = {
    handshake: { auth: { token: 'tok' }, headers: {} },
    disconnect: jest.fn(),
    join: jest.fn(),
  };
  return { gateway, client, verify };
};

describe('LogGateway (review-fix)', () => {
  afterEach(() => jest.useRealTimers());

  // F-04
  it('does not verify with a hardcoded fallback secret when none is configured', async () => {
    const { gateway, client, verify } = mk({ sub: 'admin-1', role: 'ADMIN', typ: 'access' }, {});
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalled();
    for (const c of verify.mock.calls) expect(c[1].secret).not.toMatch(/dev-insecure/);
  });

  // F-17
  it('joins the admins room only after ADMIN auth succeeds', async () => {
    const { gateway, client } = mk(
      { sub: 'admin-1', role: 'ADMIN', typ: 'access' },
      { JWT_ACCESS_SECRET: 's' },
    );
    await gateway.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('admins');
  });

  it('does not join admins for a non-admin token', async () => {
    const { gateway, client } = mk(
      { sub: 'u', role: 'STUDENT', typ: 'access' },
      { JWT_ACCESS_SECRET: 's' },
    );
    await gateway.handleConnection(client);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  // F-17
  it('emits log:new only to the admins room', () => {
    const { gateway } = mk({}, {});
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const rootEmit = jest.fn();
    (gateway as any).server = { to, emit: rootEmit };
    gateway.emitNewLog({ id: 'l1' } as any);
    expect(to).toHaveBeenCalledWith('admins');
    expect(emit).toHaveBeenCalledWith('log:new', { id: 'l1' });
    expect(rootEmit).not.toHaveBeenCalled();
  });

  // F-17
  it('disconnects the socket when the token expires (exp)', async () => {
    jest.useFakeTimers();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const { gateway, client } = mk(
      { sub: 'admin-1', role: 'ADMIN', typ: 'access', exp },
      { JWT_ACCESS_SECRET: 's' },
    );
    await gateway.handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(61_000);
    expect(client.disconnect).toHaveBeenCalled();
  });
});

describe('LogGateway expiry timers (review-fix F-17)', () => {
  afterEach(() => jest.useRealTimers());

  it('sets no timer when the token has no exp', async () => {
    jest.useFakeTimers();
    const { gateway, client } = mk(
      { sub: 'admin-1', role: 'ADMIN', typ: 'access' },
      { JWT_ACCESS_SECRET: 's' },
    );
    client.id = 'c1';
    await gateway.handleConnection(client);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handleDisconnect clears the pending expiry timer', async () => {
    jest.useFakeTimers();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const { gateway, client } = mk(
      { sub: 'admin-1', role: 'ADMIN', typ: 'access', exp },
      { JWT_ACCESS_SECRET: 's' },
    );
    client.id = 'c1';
    await gateway.handleConnection(client);
    expect(jest.getTimerCount()).toBe(1);
    (gateway as any).handleDisconnect(client);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(61_000);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
