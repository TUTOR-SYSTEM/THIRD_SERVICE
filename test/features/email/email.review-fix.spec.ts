import { readFileSync } from 'fs';
import { join } from 'path';
import { EmailService } from 'src/features/email/email.service';

const sendMock = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

const make = (extra: Record<string, string | undefined> = {}) => {
  const v: Record<string, string | undefined> = { RESEND_API_KEY: 're', MAIL_FROM: 'a@b.c', ...extra };
  return new EmailService({
    getOrThrow: (k: string) => v[k],
    get: (k: string, d?: string) => v[k] ?? d,
  } as any);
};

// F-25
describe('EmailService test email (review-fix F-25)', () => {
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({ data: { id: 'm' }, error: null });
    delete process.env.TEST_EMAIL_RECIPIENT;
  });
  afterEach(() => delete process.env.TEST_EMAIL_RECIPIENT);

  it('rejects with 400/503 when TEST_EMAIL_RECIPIENT is not set', async () => {
    await expect(make().testSendEmailService()).rejects.toMatchObject({
      status: 503,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends to the recipient from TEST_EMAIL_RECIPIENT (config or env)', async () => {
    process.env.TEST_EMAIL_RECIPIENT = 'qa@example.com';
    await make({ TEST_EMAIL_RECIPIENT: 'qa@example.com' }).testSendEmailService();
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'qa@example.com' }));
  });

  it('has no hardcoded personal email in the source', () => {
    const src = readFileSync(join(__dirname, '../../../src/features/email/email.service.ts'), 'utf8');
    expect(src).not.toContain('dang04223@gmail.com');
  });
});
