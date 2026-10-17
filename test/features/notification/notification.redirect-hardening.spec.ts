import {
  createNotificationSchema,
  isSafeRedirectUrl,
} from 'src/packages/entities/notification/notification.schema';
import { getNotificationsQuerySchema } from 'src/packages/entities/notification/notification.schema';

describe('notification redirectUrl hardening', () => {
  const originalHosts = process.env.NOTIFICATION_REDIRECT_HOSTS;
  beforeEach(() => {
    process.env.NOTIFICATION_REDIRECT_HOSTS = 'app.example.com, Docs.example.com';
  });
  afterAll(() => {
    if (originalHosts === undefined) delete process.env.NOTIFICATION_REDIRECT_HOSTS;
    else process.env.NOTIFICATION_REDIRECT_HOSTS = originalHosts;
  });

  it.each(['/', '/classes/1', '/a?b=c#d'])('accepts internal path %s', (value) => {
    expect(isSafeRedirectUrl(value)).toBe(true);
  });

  it.each([
    '//evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '/ /evil.com',
    '/a\\b',
    '/a\u0000b',
    'javascript:alert(1)',
    'http://app.example.com/x',
  ])('rejects unsafe value %j', (value) => {
    expect(isSafeRedirectUrl(value)).toBe(false);
  });

  it('accepts https only for hosts on the allowlist (case-insensitive)', () => {
    expect(isSafeRedirectUrl('https://app.example.com/x')).toBe(true);
    expect(isSafeRedirectUrl('https://docs.example.com/x')).toBe(true);
    expect(isSafeRedirectUrl('https://evil.com/x')).toBe(false);
    expect(isSafeRedirectUrl('https://app.example.com.evil.com/x')).toBe(false);
    expect(isSafeRedirectUrl('https://user:pw@app.example.com/x')).toBe(false);
  });

  it('rejects every absolute https URL when the allowlist is empty', () => {
    delete process.env.NOTIFICATION_REDIRECT_HOSTS;
    expect(isSafeRedirectUrl('https://app.example.com/x')).toBe(false);
    expect(isSafeRedirectUrl('/internal')).toBe(true);
  });

  it('rejects an unsafe redirectUrl through the create schema', () => {
    const result = createNotificationSchema.safeParse({
      type: 'SYSTEM',
      title: 't',
      content: 'c',
      redirectUrl: '/\t/evil.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('notification query search', () => {
  it.each(['', '   '])('treats blank search %j as no search', (search) => {
    const parsed = getNotificationsQuerySchema.parse({ search });
    expect(parsed.search).toBeUndefined();
  });

  it('keeps a real search term', () => {
    expect(getNotificationsQuerySchema.parse({ search: ' exam ' }).search).toBe('exam');
  });
});
