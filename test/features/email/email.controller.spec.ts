import { EmailController } from 'src/features/email/email.controller';
import { EmailService } from 'src/features/email/email.service';
import { EmailRpcController } from 'src/features/email/email.rpc.controller';
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { ROLES_KEY } from '@packages/decorators/roles.decorator';
import { Reflector } from '@nestjs/core';

describe('EmailController / EmailRpcController', () => {
  const emailService = {
    testSendEmailService: jest.fn(),
    sendForgotPasswordMail: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

<<<<<<< Updated upstream
  it('does not mark the HTTP test endpoint as public (it sends a real email)', () => {
=======
  it('requires the ADMIN role and is no longer public', () => {
>>>>>>> Stashed changes
    const reflector = new Reflector();
    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      EmailController.prototype.testSendEmailController,
    );
<<<<<<< Updated upstream
    expect(isPublic).toBeUndefined();
=======
    expect(isPublic).toBeFalsy();
    expect(reflector.get(ROLES_KEY, EmailController.prototype.testSendEmailController)).toEqual([
      'ADMIN',
    ]);
>>>>>>> Stashed changes
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

  it('RPC email.sendForgotPasswordMail forwards the payload unchanged', async () => {
    const payload = { to: 'a@b.c', resetToken: 'tok', displayName: 'A' };
    emailService.sendForgotPasswordMail.mockResolvedValue({ id: 'm3' });
    const rpc = new EmailRpcController(emailService as unknown as EmailService);

    await expect(rpc.sendForgotPasswordMail(payload)).resolves.toEqual({ id: 'm3' });
    expect(emailService.sendForgotPasswordMail).toHaveBeenCalledWith(payload);
  });
});
