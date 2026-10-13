import { Injectable, Logger } from '@nestjs/common';
import { gatewayBaseUrl } from './gateway-url';
import type { AuthProfileStatusDto, TestAuthProfile } from '@packages/entities/test-scenario';

/** Profiles backed by a real test account (`caller`/`none` need no login). */
export const ACCOUNT_PROFILES = ['admin', 'tutor', 'student', 'parent'] as const;
export type AccountProfile = (typeof ACCOUNT_PROFILES)[number];

const LOGIN_TIMEOUT_MS = 10_000;
/** Refresh a cached token this long before its `exp`, so it can't expire mid-run. */
const EXPIRY_MARGIN_MS = 60_000;
/** Used when the token carries no readable `exp`. */
const FALLBACK_TTL_MS = 5 * 60_000;

/** `TEST_ACCOUNT_STUDENT=email:password` → `{ email, password }`; the password may contain `:`. */
function accountFromEnv(profile: AccountProfile): { email: string; password: string } | null {
  const raw = process.env[`TEST_ACCOUNT_${profile.toUpperCase()}`]?.trim();
  if (!raw) return null;
  const separator = raw.indexOf(':');
  if (separator <= 0) return null;
  return { email: raw.slice(0, separator), password: raw.slice(separator + 1) };
}

/** `student@x.dev` → `s******@x.dev` (first char + stars, domain kept). */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}${'*'.repeat(Math.min(Math.max(at - 1, 3), 8))}${email.slice(at)}`;
}

function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
      exp?: number;
    };
    if (typeof payload.exp === 'number') return payload.exp * 1000 - EXPIRY_MARGIN_MS;
  } catch {
    // Not a JWT we can read — fall back to a short TTL.
  }
  return Date.now() + FALLBACK_TTL_MS;
}

/** Thrown (and recorded on the run) when a profile can't produce a token. */
export class AuthProfileError extends Error {}

/**
 * Logs the per-role test accounts in through the real gateway (`POST /auth/login`) and caches
 * their access tokens in memory until shortly before they expire, so a batch of runs logs each
 * role in once.
 */
@Injectable()
export class TestAuthService {
  private readonly logger = new Logger(TestAuthService.name);
  private readonly cache = new Map<AccountProfile, { token: string; expiresAt: number }>();
  private readonly pending = new Map<AccountProfile, Promise<string>>();

  statuses(): AuthProfileStatusDto[] {
    return ACCOUNT_PROFILES.map((profile) => {
      const account = accountFromEnv(profile);
      return { profile, configured: !!account, email: account ? maskEmail(account.email) : null };
    });
  }

  /** Drops a profile's cached token (e.g. after the gateway answered 401). */
  invalidate(profile: AccountProfile): void {
    this.cache.delete(profile);
  }

  /**
   * The token a profile runs with: the caller's own for `caller`, none for `none`, otherwise the
   * test account's (logged in on demand).
   */
  async tokenFor(profile: TestAuthProfile, callerToken?: string): Promise<string | undefined> {
    if (profile === 'none') return undefined;
    if (profile === 'caller') return callerToken;
    return this.accountToken(profile);
  }

  async accountToken(profile: AccountProfile): Promise<string> {
    const cached = this.cache.get(profile);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    // Concurrent runs for the same role share one login.
    const inFlight = this.pending.get(profile);
    if (inFlight) return inFlight;
    const login = this.login(profile).finally(() => this.pending.delete(profile));
    this.pending.set(profile, login);
    return login;
  }

  private async login(profile: AccountProfile): Promise<string> {
    const account = accountFromEnv(profile);
    const envName = `TEST_ACCOUNT_${profile.toUpperCase()}`;
    if (!account)
      throw new AuthProfileError(`Auth profile "${profile}" is not configured (${envName})`);

    const baseUrl = gatewayBaseUrl();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(account),
        signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AuthProfileError(
        `Login for auth profile "${profile}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const body = (await res.json().catch(() => null)) as {
      data?: { accessToken?: string };
      accessToken?: string;
    } | null;
    const token = body?.data?.accessToken ?? body?.accessToken;
    if (!res.ok || !token) {
      throw new AuthProfileError(
        `Login for auth profile "${profile}" returned ${res.status} — check ${envName}`,
      );
    }

    this.cache.set(profile, { token, expiresAt: expiryOf(token) });
    this.logger.log(`Logged in test account for auth profile "${profile}"`);
    return token;
  }
}
