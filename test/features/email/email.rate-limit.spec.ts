import { HttpException, HttpStatus } from '@nestjs/common';
import { EmailRpcController } from 'src/features/email/email.rpc.controller';
import { EmailService } from 'src/features/email/email.service';
import { RedisService } from 'src/features/redis/redis.service';

const VALID_TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('EmailRpcController per-recipient rate limit (report F-07)', () => {
  it('refuses the 6th reset-code mail to one address within an hour', async () => {
    const emailService = { sendPasswordResetOtpMail: jest.fn().mockResolvedValue({ id: 'm' }) };
    const redis = { incrWithWindow: jest.fn() };
    const rpc = new EmailRpcController(
      emailService as unknown as EmailService,
      redis as unknown as RedisService,
    );
    const body = { to: 'Victim@Example.com', otp: '123456' };

    redis.incrWithWindow.mockResolvedValueOnce(5);
    await expect(rpc.sendPasswordResetOtp(body as never)).resolves.toEqual({ id: 'm' });

    redis.incrWithWindow.mockResolvedValueOnce(6);
    const err = await rpc.sendPasswordResetOtp(body as never).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(emailService.sendPasswordResetOtpMail).toHaveBeenCalledTimes(1);
  });

  it('counts by a digest of the lower-cased address, not the address itself', async () => {
    const redis = { incrWithWindow: jest.fn().mockResolvedValue(1) };
    const rpc = new EmailRpcController(
      { sendVerifyEmail: jest.fn().mockResolvedValue({}) } as unknown as EmailService,
      redis as unknown as RedisService,
    );
    await rpc.sendVerifyEmail({ to: 'A@B.dev', verifyToken: VALID_TOKEN } as never);
    const [key, windowSeconds] = redis.incrWithWindow.mock.calls[0];
    expect(key).toMatch(/^mail-rate:verify:[0-9a-f]{64}$/);
    expect(key).not.toContain('b.dev');
    expect(windowSeconds).toBe(3600);
  });

  it('without Redis (unit wiring) no limit is applied', async () => {
    const emailService = { sendVerifyEmail: jest.fn().mockResolvedValue({ id: 'v' }) };
    const rpc = new EmailRpcController(emailService as unknown as EmailService);
    await expect(
      rpc.sendVerifyEmail({ to: 'a@b.dev', verifyToken: VALID_TOKEN } as never),
    ).resolves.toEqual({ id: 'v' });
  });
});
