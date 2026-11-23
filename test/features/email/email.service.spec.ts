import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from 'src/features/email/email.service';

const sendMock = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMock })),
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
  SMTP_HOST: 'smtp.test',
  MAIL_FROM: 'Tutor <noreply@tutor.dev>',
};

describe('EmailService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('throws at construction when SMTP_HOST or MAIL_FROM is missing', () => {
    expect(() => new EmailService(makeConfig({ MAIL_FROM: 'a@b.c' }))).toThrow('SMTP_HOST');
    expect(() => new EmailService(makeConfig({ SMTP_HOST: 'smtp.test' }))).toThrow('MAIL_FROM');
  });

  it('sends the reset code as one-time digit boxes in html and as plain text', async () => {
    sendMock.mockResolvedValue({ messageId: 'msg_1' });
    const service = new EmailService(makeConfig(baseConfig));

    const result = await service.sendPasswordResetOtpMail({
      to: 'parent@x.dev',
      otp: '482931',
      displayName: 'Lan',
    });

    expect(result).toEqual({ id: 'msg_1' });
    const payload = sendMock.mock.calls[0][0];
    expect(payload.from).toBe('Tutor <noreply@tutor.dev>');
    expect(payload.to).toBe('parent@x.dev');
    expect(payload.subject).toBe('Mã đặt lại mật khẩu của bạn');
    expect(payload.subject).not.toContain('482931');
    // One boxed cell per digit, in order.
    for (const digit of '482931') {
      expect(payload.html).toContain(
        `font-size:28px;font-weight:700;color:#0f172a;">${digit}</td>`,
      );
    }
    expect(payload.html).toContain('Mã có hiệu lực trong 5 phút');
    expect(payload.text).toContain('Mã xác nhận: 482931');
    // The reset is a code now: no link to the reset page is sent.
    expect(payload.html).not.toContain('reset-password?token=');
    expect(payload.text).not.toContain('reset-password?token=');
  });

  it('escapes HTML special characters in the display name but not in the plain-text body', async () => {
    sendMock.mockResolvedValue({ messageId: 'm' });
    const service = new EmailService(makeConfig(baseConfig));
    const name = `<script>"x"&'y'</script>`;

    await service.sendPasswordResetOtpMail({ to: 'a@b.c', otp: '123456', displayName: name });

    const { html, text } = sendMock.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;');
    expect(html).toContain('&#34;x&#34;&#38;&#39;y&#39;');
    expect(text).toContain(name);
  });

  it('rethrows and logs when the transport rejects', async () => {
    sendMock.mockRejectedValue(new Error('domain not verified'));
    const service = new EmailService(makeConfig(baseConfig));

    await expect(
      service.sendPasswordResetOtpMail({ to: 'a@b.c', otp: '123456', displayName: 'A' }),
    ).rejects.toThrow('domain not verified');
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('propagates transport exceptions from nodemailer', async () => {
    sendMock.mockRejectedValue(new Error('ECONNRESET'));
    const service = new EmailService(
      makeConfig({ ...baseConfig, TEST_EMAIL_RECIPIENT: 'qa@x.dev' }),
    );

    await expect(service.testSendEmailService()).rejects.toThrow('ECONNRESET');
  });
});

describe('EmailService SMTP transport config', () => {
  const nodemailer = jest.requireMock('nodemailer') as { createTransport: jest.Mock };

  beforeEach(() => nodemailer.createTransport.mockClear());

  it('creates the transport from SMTP_* env with port 587 / no TLS-on-connect by default', () => {
    new EmailService(makeConfig({ ...baseConfig, SMTP_HOST: 'smtp.x.dev' }));
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.x.dev',
      port: 587,
      secure: false,
      auth: undefined,
    });
  });

  it('uses implicit TLS on port 465 and passes auth when user/pass are set', () => {
    new EmailService(
      makeConfig({
        ...baseConfig,
        SMTP_HOST: 'smtp.x.dev',
        SMTP_PORT: '465',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      }),
    );
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, auth: { user: 'u', pass: 'p' } }),
    );
  });

  it('throws when SMTP_USER is set without SMTP_PASS (or vice versa)', () => {
    expect(
      () => new EmailService(makeConfig({ ...baseConfig, SMTP_HOST: 'h', SMTP_USER: 'u' })),
    ).toThrow('SMTP_USER and SMTP_PASS');
  });

  it('throws on a non-numeric SMTP_PORT', () => {
    expect(
      () => new EmailService(makeConfig({ ...baseConfig, SMTP_HOST: 'h', SMTP_PORT: 'abc' })),
    ).toThrow('SMTP_PORT');
  });
});
