import { PATTERN_METADATA, PARAM_ARGS_METADATA } from '@nestjs/microservices/constants';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailRpcController } from 'src/features/email/email.rpc.controller';
import { EmailService } from 'src/features/email/email.service';
import { renderAccountCreatedEmail } from 'src/features/email/templates/account-created.template';

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

/** The schema is module-private, so pull the ZodValidationPipe that `@Payload(...)` attached. */
function payloadPipe(method: keyof EmailRpcController) {
  const meta = Reflect.getMetadata(PARAM_ARGS_METADATA, EmailRpcController, method) as Record<
    string,
    { pipes?: { transform: (v: unknown) => unknown }[] }
  >;
  const entry = Object.values(meta).find((m) => m.pipes?.length);
  if (!entry?.pipes?.[0]) throw new Error(`no payload pipe on ${String(method)}`);
  return entry.pipes[0];
}

const validPayload = {
  to: 'student@x.dev',
  email: 'student@x.dev',
  username: 'lan.nguyen',
  password: 'Tmp-Pass_123',
  displayName: 'Lan',
};

describe('EmailRpcController.sendAccountCreated (email.sendAccountCreated)', () => {
  const emailService = { sendAccountCreatedMail: jest.fn() };
  let rpc: EmailRpcController;

  beforeEach(() => {
    jest.clearAllMocks();
    emailService.sendAccountCreatedMail.mockResolvedValue({ id: 'a1' });
    rpc = new EmailRpcController(emailService as unknown as EmailService);
  });

  it('is bound to the email.sendAccountCreated message pattern', () => {
    expect(
      Reflect.getMetadata(PATTERN_METADATA, EmailRpcController.prototype.sendAccountCreated),
    ).toEqual(['email.sendAccountCreated']);
  });

  it('forwards a valid payload to EmailService.sendAccountCreatedMail', async () => {
    const payload = payloadPipe('sendAccountCreated').transform(validPayload);
    await expect(rpc.sendAccountCreated(payload as never)).resolves.toEqual({ id: 'a1' });
    expect(emailService.sendAccountCreatedMail).toHaveBeenCalledWith(validPayload);
  });

  it("defaults a missing displayName to ''", async () => {
    const { displayName: _omit, ...rest } = validPayload;
    const payload = payloadPipe('sendAccountCreated').transform(rest);
    await rpc.sendAccountCreated(payload as never);
    expect(emailService.sendAccountCreatedMail).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: '' }),
    );
  });

  it.each([
    ['missing to', { ...validPayload, to: undefined }],
    ['malformed to', { ...validPayload, to: 'not-an-email' }],
    ['missing username', { ...validPayload, username: undefined }],
    ['empty password', { ...validPayload, password: '' }],
    ['non-string password', { ...validPayload, password: 42 }],
    ['null payload', null],
  ])('rejects an invalid payload (%s) before reaching EmailService', (_label, bad) => {
    expect(() => payloadPipe('sendAccountCreated').transform(bad)).toThrow();
    expect(emailService.sendAccountCreatedMail).not.toHaveBeenCalled();
  });
});

describe('EmailService.sendAccountCreatedMail', () => {
  beforeEach(() => {
    sendMock.mockReset();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends credentials in the body, with a login link, and keeps the password out of the subject', async () => {
    sendMock.mockResolvedValue({ messageId: 'msg_2' });
    const service = new EmailService(makeConfig(baseConfig));

    const result = await service.sendAccountCreatedMail({
      to: 'student@x.dev',
      displayName: 'Lan',
      email: 'student@x.dev',
      username: 'lan.nguyen',
      password: 'Tmp-Pass_123',
    });

    expect(result).toEqual({ id: 'msg_2' });
    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe('student@x.dev');
    expect(payload.subject).not.toContain('Tmp-Pass_123');
    expect(payload.html).toContain('Tmp-Pass_123');
    expect(payload.text).toContain('Mật khẩu tạm: Tmp-Pass_123');
    expect(payload.html).toContain('href="https://app.tutor.dev/login"');
    expect(payload.text).toContain('https://app.tutor.dev/login');
  });

  it('does not log the password', async () => {
    sendMock.mockResolvedValue({ messageId: 'msg_3' });
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    const service = new EmailService(makeConfig(baseConfig));

    await service.sendAccountCreatedMail({
      to: 'a@x.dev',
      displayName: 'A',
      email: 'a@x.dev',
      username: 'a',
      password: 'Secret-Pass-999',
    });

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain('Secret-Pass-999');
  });
});

describe('renderAccountCreatedEmail', () => {
  it('escapes every interpolated value', () => {
    const { html } = renderAccountCreatedEmail({
      displayName: '<img src=x onerror=alert(1)>',
      email: 'a@x.dev',
      username: '"><script>',
      password: "p'w<b>",
      loginUrl: 'https://app.tutor.dev/login',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain("p'w<b>");
    expect(html).toContain('&#60;');
  });
});
