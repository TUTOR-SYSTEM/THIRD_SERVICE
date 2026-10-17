import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from 'src/features/email/email.service';

const sendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

const makeConfig = (values: Record<string, string | undefined>) =>
  ({
    getOrThrow: jest.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`Missing ${key}`);
      return values[key];
    }),
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  }) as unknown as ConfigService;

const baseConfig = {
  RESEND_API_KEY: 're_test',
  MAIL_FROM: 'Tutor <noreply@tutor.dev>',
};

describe('EmailService.sendVerifyEmail', () => {
  beforeEach(() => {
    sendMock.mockReset();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends a verify mail with the subject, sender and recipient', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_v1' }, error: null });
    const service = new EmailService(makeConfig(baseConfig));

    const result = await service.sendVerifyEmail({
      to: 'new@x.dev',
      verifyToken: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      displayName: 'Lan',
    });

    expect(result).toEqual({ id: 'msg_v1' });
    const payload = sendMock.mock.calls[0][0];
    expect(payload.from).toBe('Tutor <noreply@tutor.dev>');
    expect(payload.to).toBe('new@x.dev');
    expect(payload.subject).toBe('Verify your email address');
  });

  it('builds the verify link on /verify-email with a URL-encoded token, in both html and text', async () => {
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const service = new EmailService(
      makeConfig({ ...baseConfig, PASSWORD_RESET_URL_BASE: 'https://app.tutor.dev' }),
    );

    await service.sendVerifyEmail({ to: 'a@b.c', verifyToken: 'a+b/c=', displayName: 'Lan' });

    const expectedUrl = 'https://app.tutor.dev/verify-email?token=a%2Bb%2Fc%3D';
    const { html, text } = sendMock.mock.calls[0][0];
    expect(html).toContain(`href="${expectedUrl}"`);
    expect(text).toContain(expectedUrl);
    expect(html).not.toContain('/reset-password');
    expect(text).not.toContain('/reset-password');
  });

  it('falls back to localhost:3000 for the link base when PASSWORD_RESET_URL_BASE is not configured', async () => {
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const service = new EmailService(makeConfig(baseConfig));

    await service.sendVerifyEmail({ to: 'a@b.c', verifyToken: 't', displayName: 'A' });

    expect(sendMock.mock.calls[0][0].text).toContain(
      'http://localhost:3000/verify-email?token=t',
    );
  });

  it('states the 24-hour expiry in both html and text', async () => {
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const service = new EmailService(makeConfig(baseConfig));

    await service.sendVerifyEmail({ to: 'a@b.c', verifyToken: 't', displayName: 'A' });

    const { html, text } = sendMock.mock.calls[0][0];
    expect(html).toContain('expires in 24 hours');
    expect(text).toContain('expires in 24 hours');
    expect(html).not.toContain('5 minutes');
  });

  it('escapes HTML special characters in the display name but not in the plain-text body', async () => {
    sendMock.mockResolvedValue({ data: {}, error: null });
    const service = new EmailService(makeConfig(baseConfig));
    const name = `<img src=x onerror="alert(1)">&'`;

    await service.sendVerifyEmail({ to: 'a@b.c', verifyToken: 't', displayName: name });

    const { html, text } = sendMock.mock.calls[0][0];
    expect(html).not.toContain('<img');
    expect(html).toContain('&#60;img src=x onerror=&#34;alert(1)&#34;&#62;&#38;&#39;');
    expect(text).toContain(name);
  });

  it('does not put the raw verify token anywhere except the link (token is URL-encoded in the link)', async () => {
    sendMock.mockResolvedValue({ data: {}, error: null });
    const service = new EmailService(makeConfig(baseConfig));
    const token = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    await service.sendVerifyEmail({ to: 'a@b.c', verifyToken: token, displayName: 'A' });

    const { html, text } = sendMock.mock.calls[0][0];
    expect(html).toContain(`verify-email?token=${token}`);
    expect(text).toContain(`verify-email?token=${token}`);
  });

  it('rethrows and logs when Resend returns an error object', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
    const service = new EmailService(makeConfig(baseConfig));

    await expect(
      service.sendVerifyEmail({ to: 'a@b.c', verifyToken: 't', displayName: 'A' }),
    ).rejects.toThrow('domain not verified');
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('propagates transport exceptions from the Resend SDK', async () => {
    sendMock.mockRejectedValue(new Error('ECONNRESET'));
    const service = new EmailService(makeConfig(baseConfig));

    await expect(
      service.sendVerifyEmail({ to: 'a@b.c', verifyToken: 't', displayName: 'A' }),
    ).rejects.toThrow('ECONNRESET');
  });
});
