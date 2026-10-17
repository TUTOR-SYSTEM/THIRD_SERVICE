import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { PARAM_ARGS_METADATA } from '@nestjs/microservices/constants';
import { EmailRpcController } from 'src/features/email/email.rpc.controller';
import { EmailService } from 'src/features/email/email.service';

const VALID_TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

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

describe('EmailRpcController.sendVerifyEmail (email.sendVerifyEmail)', () => {
  const emailService = { sendVerifyEmail: jest.fn(), sendForgotPasswordMail: jest.fn() };
  let rpc: EmailRpcController;

  beforeEach(() => {
    jest.clearAllMocks();
    emailService.sendVerifyEmail.mockResolvedValue({ id: 'v1' });
    rpc = new EmailRpcController(emailService as unknown as EmailService);
  });

  it('is bound to the email.sendVerifyEmail message pattern', () => {
    expect(Reflect.getMetadata(PATTERN_METADATA, EmailRpcController.prototype.sendVerifyEmail)).toEqual(
      ['email.sendVerifyEmail'],
    );
  });

  it('forwards a valid payload to EmailService.sendVerifyEmail and returns its result', async () => {
    const pipe = payloadPipe('sendVerifyEmail');
    const payload = pipe.transform({ to: 'new@x.dev', verifyToken: VALID_TOKEN, displayName: 'Lan' });

    await expect(rpc.sendVerifyEmail(payload as never)).resolves.toEqual({ id: 'v1' });
    expect(emailService.sendVerifyEmail).toHaveBeenCalledWith({
      to: 'new@x.dev',
      verifyToken: VALID_TOKEN,
      displayName: 'Lan',
    });
  });

  it("defaults a missing or null displayName to ''", async () => {
    const pipe = payloadPipe('sendVerifyEmail');

    for (const displayName of [undefined, null]) {
      const payload = pipe.transform({ to: 'a@tutor.dev', verifyToken: VALID_TOKEN, displayName });
      await rpc.sendVerifyEmail(payload as never);
    }

    expect(emailService.sendVerifyEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayName: '' }));
    expect(emailService.sendVerifyEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({ displayName: '' }));
  });

  it.each([
    ['missing to', { verifyToken: VALID_TOKEN, displayName: 'A' }],
    ['malformed email', { to: 'not-an-email', verifyToken: VALID_TOKEN, displayName: 'A' }],
    ['email over 254 chars', { to: `${'a'.repeat(250)}@tutor.dev`, verifyToken: VALID_TOKEN, displayName: 'A' }],
    ['verifyToken not a uuid', { to: 'a@tutor.dev', verifyToken: 'abc', displayName: 'A' }],
    ['missing verifyToken', { to: 'a@tutor.dev', displayName: 'A' }],
    ['displayName over 200 chars', { to: 'a@tutor.dev', verifyToken: VALID_TOKEN, displayName: 'x'.repeat(201) }],
    ['non-string displayName', { to: 'a@tutor.dev', verifyToken: VALID_TOKEN, displayName: 42 }],
    ['null payload', null],
  ])('rejects an invalid payload (%s) before reaching EmailService', (_label, bad) => {
    const pipe = payloadPipe('sendVerifyEmail');

    expect(() => pipe.transform(bad)).toThrow();
    expect(emailService.sendVerifyEmail).not.toHaveBeenCalled();
  });

  it('accepts displayName at exactly 200 chars', () => {
    const pipe = payloadPipe('sendVerifyEmail');
    expect(() =>
      pipe.transform({ to: 'a@tutor.dev', verifyToken: VALID_TOKEN, displayName: 'x'.repeat(200) }),
    ).not.toThrow();
  });
});
