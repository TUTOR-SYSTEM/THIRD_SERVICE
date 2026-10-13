import { AuthProfileError, TestAuthService } from 'src/features/test-scenario/test-auth.service';

const jwt = (expSeconds: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.s`;

describe('TestAuthService', () => {
  const fetchMock = jest.fn();
  const env = { ...process.env };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.TEST_ACCOUNT_STUDENT = 'student@x.dev:pa:ss';
    delete process.env.TEST_ACCOUNT_TUTOR;
  });
  afterAll(() => {
    process.env = env;
  });

  it('reports configured profiles with the email only', () => {
    const statuses = new TestAuthService().statuses();
    expect(statuses).toContainEqual({ profile: 'student', configured: true, email: 's******@x.dev' });
    expect(statuses).toContainEqual({ profile: 'tutor', configured: false, email: null });
    expect(JSON.stringify(statuses)).not.toContain('pa:ss');
  });

  it('returns the caller token for caller and nothing for none, without logging in', async () => {
    const auth = new TestAuthService();
    await expect(auth.tokenFor('caller', 'abc')).resolves.toBe('abc');
    await expect(auth.tokenFor('none', 'abc')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a role in once (password may contain ":") and caches the token until it nears expiry', async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { accessToken: token } }) });
    const auth = new TestAuthService();

    const [a, b] = await Promise.all([auth.tokenFor('student'), auth.tokenFor('student')]);
    await auth.tokenFor('student');

    expect(a).toBe(token);
    expect(b).toBe(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'student@x.dev', password: 'pa:ss' });
  });

  it('logs in again once the cached token is about to expire', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { accessToken: jwt(Math.floor(Date.now() / 1000) + 30) } }),
    });
    const auth = new TestAuthService();
    await auth.tokenFor('student');
    await auth.tokenFor('student');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails clearly when a profile is not configured or the login is rejected', async () => {
    const auth = new TestAuthService();
    await expect(auth.tokenFor('tutor')).rejects.toThrow('TEST_ACCOUNT_TUTOR');

    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'INVALID_PASSWORD' }) });
    await expect(auth.tokenFor('student')).rejects.toBeInstanceOf(AuthProfileError);
  });
});

describe('TestAuthService — full case matrix', () => {
  const fetchMock = jest.fn();
  const env = { ...process.env };
  const loginOk = (token: string) => ({ ok: true, status: 200, json: async () => ({ data: { accessToken: token } }) });

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.GATEWAY_BASE_URL;
    process.env.TEST_ACCOUNT_STUDENT = 'student@x.dev:pa:ss';
    process.env.TEST_ACCOUNT_TUTOR = 'tutor@x.dev:t0k';
    delete process.env.TEST_ACCOUNT_ADMIN;
    delete process.env.TEST_ACCOUNT_PARENT;
  });
  afterAll(() => {
    process.env = env;
  });

  describe('accountFromEnv parsing (via statuses)', () => {
    it.each([
      ['no separator', 'justanemail', null],
      ['leading separator (empty email)', ':secret', null],
    ])('treats %s as not configured', (_label, raw, email) => {
      process.env.TEST_ACCOUNT_TUTOR = raw;
      const status = new TestAuthService().statuses().find((s) => s.profile === 'tutor');
      expect(status).toEqual({ profile: 'tutor', configured: false, email });
    });

    it('splits on the first colon so passwords may contain colons', () => {
      const status = new TestAuthService().statuses().find((s) => s.profile === 'student');
      expect(status).toEqual({ profile: 'student', configured: true, email: 's******@x.dev' });
    });

    it('reports every account profile, in order', () => {
      const profiles = new TestAuthService().statuses().map((s) => s.profile);
      expect(profiles).toEqual(['admin', 'tutor', 'student', 'parent']);
    });
  });

  describe('tokenFor', () => {
    it('returns the caller token as is (even when undefined)', async () => {
      const auth = new TestAuthService();
      await expect(auth.tokenFor('caller', 'mine')).resolves.toBe('mine');
      await expect(auth.tokenFor('caller')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns undefined for the none profile without logging in', async () => {
      await expect(new TestAuthService().tokenFor('none')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('logs in a role profile through the account token path', async () => {
      fetchMock.mockResolvedValue(loginOk('jwt-s'));
      await expect(new TestAuthService().tokenFor('student', 'ignored')).resolves.toBe('jwt-s');
    });
  });

  describe('login request', () => {
    it('posts the email and password to {GATEWAY_BASE_URL}/auth/login as JSON', async () => {
      process.env.GATEWAY_BASE_URL = 'http://gw.test:9000/';
      fetchMock.mockResolvedValue(loginOk('jwt-a'));
      await new TestAuthService().accountToken('student');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://gw.test:9000/auth/login');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'content-type': 'application/json' });
      expect(JSON.parse(init.body)).toEqual({ email: 'student@x.dev', password: 'pa:ss' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('defaults the gateway base URL to localhost:8888', async () => {
      fetchMock.mockResolvedValue(loginOk('jwt-b'));
      await new TestAuthService().accountToken('student');
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8888/auth/login');
    });

    it('accepts a token at the top level of the body when there is no data wrapper', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ accessToken: 'flat' }) });
      await expect(new TestAuthService().accountToken('student')).resolves.toBe('flat');
    });

    it('fails with the profile name and env var when the body is not JSON', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('x')) });
      await expect(new TestAuthService().accountToken('student')).rejects.toThrow(
        'Login for auth profile "student" returned 502 — check TEST_ACCOUNT_STUDENT',
      );
    });

    it('fails when the response is 200 but carries no token', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) });
      await expect(new TestAuthService().accountToken('student')).rejects.toBeInstanceOf(AuthProfileError);
    });

    it('wraps a network failure with the profile name', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      await expect(new TestAuthService().accountToken('student')).rejects.toThrow(
        'Login for auth profile "student" failed: ECONNRESET',
      );
    });

    it('stringifies a non-Error network rejection', async () => {
      fetchMock.mockRejectedValue('boom');
      await expect(new TestAuthService().accountToken('student')).rejects.toThrow('failed: boom');
    });

    it('names the missing env var for an unconfigured profile without calling the network', async () => {
      const error = await new TestAuthService().accountToken('admin').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthProfileError);
      expect((error as Error).message).toBe('Auth profile "admin" is not configured (TEST_ACCOUNT_ADMIN)');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('token cache', () => {
    it('shares one in-flight login between concurrent callers', async () => {
      let resolveLogin: (v: unknown) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise((r) => (resolveLogin = r)));
      const auth = new TestAuthService();

      const first = auth.accountToken('student');
      const second = auth.accountToken('student');
      resolveLogin(loginOk('shared'));

      await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('clears the in-flight entry after a failed login so the next call retries', async () => {
      fetchMock.mockRejectedValueOnce(new Error('down'));
      const auth = new TestAuthService();
      await expect(auth.accountToken('student')).rejects.toThrow('down');

      fetchMock.mockResolvedValueOnce(loginOk('recovered'));
      await expect(auth.accountToken('student')).resolves.toBe('recovered');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('caches per profile, so a different role triggers its own login', async () => {
      fetchMock.mockResolvedValueOnce(loginOk('s-token')).mockResolvedValueOnce(loginOk('t-token'));
      const auth = new TestAuthService();
      await expect(auth.accountToken('student')).resolves.toBe('s-token');
      await expect(auth.accountToken('tutor')).resolves.toBe('t-token');
      await expect(auth.accountToken('student')).resolves.toBe('s-token');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('token expiry', () => {
    const jwtWithExp = (exp: number) =>
      `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;

    it('re-logs in once the token is within the expiry margin', async () => {
      const now = Date.now();
      const soon = Math.floor((now + 30_000) / 1000); // inside the safety margin
      fetchMock.mockResolvedValueOnce(loginOk(jwtWithExp(soon))).mockResolvedValueOnce(loginOk('fresh'));
      const auth = new TestAuthService();
      await auth.accountToken('student');
      await expect(auth.accountToken('student')).resolves.toBe('fresh');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps a token whose exp is comfortably in the future', async () => {
      const later = Math.floor((Date.now() + 3_600_000) / 1000);
      fetchMock.mockResolvedValueOnce(loginOk(jwtWithExp(later)));
      const auth = new TestAuthService();
      await auth.accountToken('student');
      await expect(auth.accountToken('student')).resolves.toBe(jwtWithExp(later));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to a short TTL for an opaque (non-JWT) token', async () => {
      fetchMock.mockResolvedValueOnce(loginOk('opaque-token'));
      const auth = new TestAuthService();
      await auth.accountToken('student');
      await expect(auth.accountToken('student')).resolves.toBe('opaque-token');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to a short TTL when the JWT payload has no numeric exp', async () => {
      const noExp = `h.${Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url')}.s`;
      fetchMock.mockResolvedValueOnce(loginOk(noExp));
      const auth = new TestAuthService();
      await auth.accountToken('student');
      await expect(auth.accountToken('student')).resolves.toBe(noExp);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to a short TTL when the JWT payload is not valid JSON', async () => {
      const garbage = `h.${Buffer.from('not-json{').toString('base64url')}.s`;
      fetchMock.mockResolvedValueOnce(loginOk(garbage));
      const auth = new TestAuthService();
      await auth.accountToken('student');
      await expect(auth.accountToken('student')).resolves.toBe(garbage);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
