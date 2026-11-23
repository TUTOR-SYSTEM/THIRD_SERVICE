import { resolveDetailUrl, withDetailUrl } from 'src/features/notification/notification.detail-url';

describe('notification detail URL', () => {
  const originalHosts = process.env.NOTIFICATION_REDIRECT_HOSTS;

  beforeEach(() => {
    process.env.NOTIFICATION_REDIRECT_HOSTS = 'app.example.com';
  });

  afterAll(() => {
    if (originalHosts === undefined) delete process.env.NOTIFICATION_REDIRECT_HOSTS;
    else process.env.NOTIFICATION_REDIRECT_HOSTS = originalHosts;
  });

  it('uses a safe internal redirectUrl when the sender set one', () => {
    expect(resolveDetailUrl({ type: 'TUTOR', redirectUrl: '/exercises/123' })).toBe(
      '/exercises/123',
    );
  });

  it('accepts an https URL only when its host is allow-listed', () => {
    expect(resolveDetailUrl({ type: 'TUTOR', redirectUrl: 'https://app.example.com/x' })).toBe(
      'https://app.example.com/x',
    );
    expect(resolveDetailUrl({ type: 'TUTOR', redirectUrl: 'https://evil.com/x' })).toBe(
      '/notifications',
    );
  });

  it('falls back to the per-type page for unsafe or missing redirectUrl', () => {
    expect(resolveDetailUrl({ type: 'TUITION', redirectUrl: '//evil.com' })).toBe('/fees');
    expect(resolveDetailUrl({ type: 'STUDENT', redirectUrl: null })).toBe('/grades');
    expect(resolveDetailUrl({ type: 'TUTOR', redirectUrl: '   ' })).toBe('/notifications');
  });

  it('falls back to /notifications for an unknown type', () => {
    expect(resolveDetailUrl({ type: 'UNKNOWN' })).toBe('/notifications');
  });

  it('adds detailUrl without changing the other fields', () => {
    const note = { id: 'n1', type: 'STUDENT', title: 'T', redirectUrl: null };
    expect(withDetailUrl(note)).toEqual({ ...note, detailUrl: '/grades' });
  });
});
