import { EmailController } from 'src/features/email/email.controller';
import { EmailService } from 'src/features/email/email.service';
import { EmailRpcController } from 'src/features/email/email.rpc.controller';
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { ROLES_KEY } from '@packages/decorators/roles.decorator';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminRoleGuard } from '@packages/guards';

describe('EmailController / EmailRpcController', () => {
  const emailService = {
    testSendEmailService: jest.fn(),
    sendPasswordResetOtpMail: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('is ADMIN only: not @Public and guarded by AdminRoleGuard', () => {
    const reflector = new Reflector();
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, EmailController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, EmailController)).toContain(AdminRoleGuard);
  });

  it('HTTP GET /emails delegates to testSendEmailService and returns its result', async () => {
    emailService.testSendEmailService.mockResolvedValue({ id: 'm1' });
    const controller = new EmailController(emailService as unknown as EmailService);

    await expect(controller.testSendEmailController()).resolves.toEqual({ id: 'm1' });
    expect(emailService.testSendEmailService).toHaveBeenCalledTimes(1);
  });

  it('HTTP GET /emails surfaces provider failures instead of swallowing them', async () => {
    emailService.testSendEmailService.mockRejectedValue(new Error('boom'));
    const controller = new EmailController(emailService as unknown as EmailService);

    await expect(controller.testSendEmailController()).rejects.toThrow('boom');
  });

  it('RPC email.test forwards to testSendEmail with no payload', async () => {
    emailService.testSendEmailService.mockResolvedValue({ id: 'm2' });
    const rpc = new EmailRpcController(emailService as unknown as EmailService);

    await expect(rpc.testSendEmail()).resolves.toEqual({ id: 'm2' });
  });

  it('RPC email.sendPasswordResetOtp forwards the validated payload', async () => {
    const payload = { to: 'a@b.c', otp: '482931', displayName: 'A' };
    emailService.sendPasswordResetOtpMail.mockResolvedValue({ id: 'm3' });
    const rpc = new EmailRpcController(emailService as unknown as EmailService);

    await expect(rpc.sendPasswordResetOtp(payload)).resolves.toEqual({ id: 'm3' });
    expect(emailService.sendPasswordResetOtpMail).toHaveBeenCalledWith(payload);
  });
});
