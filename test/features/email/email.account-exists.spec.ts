import { PATTERN_METADATA, PARAM_ARGS_METADATA } from '@nestjs/microservices/constants';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailRpcController } from 'src/features/email/email.rpc.controller';
import { EmailService } from 'src/features/email/email.service';
import { renderAccountExistsEmail } from 'src/features/email/templates/account-exists.template';

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
  PASSWORD_RESET_URL_BASE: 'https://app.tutor.dev',
};

function payloadPipe(method: keyof EmailRpcController) {
  const meta = Reflect.getMetadata(PARAM_ARGS_METADATA, EmailRpcController, method) as Record<
    string,
    { pipes?: { transform: (v: unknown) => unknown }[] }
  >;
  const entry = Object.values(meta).find((m) => m.pipes?.length);
  if (!entry?.pipes?.[0]) throw new Error(`no payload pipe on ${String(method)}`);
  return entry.pipes[0];
}

describe('EmailRpcController.sendAccountExists (email.sendAccountExists)', () => {
  const emailService = { sendAccountExistsMail: jest.fn() };
  let rpc: EmailRpcController;

  beforeEach(() => {
    jest.clearAllMocks();
    emailService.sendAccountExistsMail.mockResolvedValue({ id: 'e1' });
    rpc = new EmailRpcController(emailService as unknown as EmailService);
  });

  it('is bound to the email.sendAccountExists message pattern', () => {
    expect(
      Reflect.getMetadata(PATTERN_METADATA, EmailRpcController.prototype.sendAccountExists),
    ).toEqual(['email.sendAccountExists']);
  });

  it('forwards a valid payload to EmailService.sendAccountExistsMail', async () => {
    const payload = payloadPipe('sendAccountExists').transform({
      to: 'lan@x.dev',
      email: 'lan@x.dev',
      displayName: 'Lan',
    });
    await expect(rpc.sendAccountExists(payload as never)).resolves.toEqual({ id: 'e1' });
    expect(emailService.sendAccountExistsMail).toHaveBeenCalledWith({
      to: 'lan@x.dev',
      email: 'lan@x.dev',
      displayName: 'Lan',
    });
  });

  it('rejects a malformed recipient', () => {
    expect(() =>
      payloadPipe('sendAccountExists').transform({ to: 'not-an-email', email: 'x@y.dev' }),
    ).toThrow();
    expect(emailService.sendAccountExistsMail).not.toHaveBeenCalled();
  });
});

describe('EmailService.sendAccountExistsMail', () => {
  beforeEach(() => {
    sendMock.mockReset();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('mails the owner with a login link and no secret', async () => {
    sendMock.mockResolvedValue({ messageId: 'msg_9' });
    const service = new EmailService(makeConfig(baseConfig));
    await service.sendAccountExistsMail({
      to: 'lan@x.dev',
      displayName: 'Lan',
      email: 'lan@x.dev',
    });
    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe('lan@x.dev');
    expect(payload.html).toContain('href="https://app.tutor.dev/login"');
    expect(payload.text).toContain('https://app.tutor.dev/login');
    expect(payload.subject).not.toMatch(/mật khẩu|password/i);
  });
});

describe('renderAccountExistsEmail', () => {
  it('escapes every interpolated value', () => {
    const { html } = renderAccountExistsEmail({
      displayName: '<img src=x onerror=alert(1)>',
      email: '"><script>@x.dev',
      loginUrl: 'https://app.tutor.dev/login',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
  });
});
