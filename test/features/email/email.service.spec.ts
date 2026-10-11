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

describe('EmailService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('throws at construction when RESEND_API_KEY or MAIL_FROM is missing', () => {
    expect(() => new EmailService(makeConfig({ MAIL_FROM: 'a@b.c' }))).toThrow('RESEND_API_KEY');
    expect(() => new EmailService(makeConfig({ RESEND_API_KEY: 're' }))).toThrow('MAIL_FROM');
  });

  it('sends a reset-password mail with a URL-encoded token and the configured base URL', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const service = new EmailService(
      makeConfig({ ...baseConfig, PASSWORD_RESET_URL_BASE: 'https://app.tutor.dev' }),
    );

    const result = await service.sendForgotPasswordMail({
      to: 'parent@x.dev',
      resetToken: 'a+b/c=',
      displayName: 'Lan',
    });

    expect(result).toEqual({ id: 'msg_1' });
    const payload = sendMock.mock.calls[0][0];
    expect(payload.from).toBe('Tutor <noreply@tutor.dev>');
    expect(payload.to).toBe('parent@x.dev');
    expect(payload.subject).toBe('Reset your password');
    const expectedUrl = 'https://app.tutor.dev/reset-password?token=a%2Bb%2Fc%3D';
    expect(payload.html).toContain(`href="${expectedUrl}"`);
    expect(payload.text).toContain(expectedUrl);
  });

  it('falls back to localhost for the reset URL base when not configured', async () => {
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const service = new EmailService(makeConfig(baseConfig));

    await service.sendForgotPasswordMail({ to: 'a@b.c', resetToken: 't', displayName: 'A' });

    expect(sendMock.mock.calls[0][0].text).toContain('http://localhost:3000/reset-password?token=t');
  });

  it('escapes HTML special characters in the display name but not in the plain-text body', async () => {
    sendMock.mockResolvedValue({ data: {}, error: null });
    const service = new EmailService(makeConfig(baseConfig));
    const name = `<script>"x"&'y'</script>`;

    await service.sendForgotPasswordMail({ to: 'a@b.c', resetToken: 't', displayName: name });

    const { html, text } = sendMock.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;');
    expect(html).toContain('&#34;x&#34;&#38;&#39;y&#39;');
    expect(text).toContain(name);
  });

  it('rethrows and logs when Resend returns an error object', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
    const service = new EmailService(makeConfig(baseConfig));

    await expect(
      service.sendForgotPasswordMail({ to: 'a@b.c', resetToken: 't', displayName: 'A' }),
    ).rejects.toThrow('domain not verified');
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('propagates transport exceptions from the Resend SDK', async () => {
    sendMock.mockRejectedValue(new Error('ECONNRESET'));
    const service = new EmailService(makeConfig(baseConfig));

    await expect(service.testSendEmailService()).rejects.toThrow('ECONNRESET');
  });
});
