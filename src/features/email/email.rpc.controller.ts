import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { ZodValidationPipe } from '@packages/pipes/zod-validation.pipe';
import { EmailService } from './email.service';

/**
 * RPC payload for the reset-password mail. `resetToken` is the reset `jti` (a random UUID minted
 * by `user`), and `to` must be a real address: without this, any publisher could make the
 * configured `MAIL_FROM` send mail to an arbitrary recipient (TRD3-15).
 */
const forgotPasswordPayloadSchema = z.object({
  to: z.email().max(254),
  resetToken: z.uuid(),
  displayName: z.string().max(200).nullish(),
});

/**
 * RPC payload for the verify-email mail. `verifyToken` is the verification token minted by `user`
 * (validated like `resetToken`); `to` is validated the same way as the reset mail (TRD3-15).
 */
const verifyEmailPayloadSchema = z.object({
  to: z.email().max(254),
  verifyToken: z.uuid(),
  displayName: z.string().max(200).nullish(),
});

/**
 * Message-pattern mirror of `EmailController` — reached by the gateway's/`user`'s
 * `RmqProducer` over the `third_queue` RabbitMQ queue. Delegates to
 * the same, unmodified `EmailService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class EmailRpcController {
  constructor(private readonly emailService: EmailService) {}

  @MessagePattern('email.test')
  testSendEmail() {
    return this.emailService.testSendEmailService();
  }

  @MessagePattern('email.sendForgotPasswordMail')
  sendForgotPasswordMail(
    @Payload(new ZodValidationPipe(forgotPasswordPayloadSchema))
    payload: z.infer<typeof forgotPasswordPayloadSchema>,
  ) {
    return this.emailService.sendForgotPasswordMail({
      to: payload.to,
      resetToken: payload.resetToken,
      displayName: payload.displayName ?? '',
    });
  }

  @MessagePattern('email.sendVerifyEmail')
  sendVerifyEmail(
    @Payload(new ZodValidationPipe(verifyEmailPayloadSchema))
    payload: z.infer<typeof verifyEmailPayloadSchema>,
  ) {
    return this.emailService.sendVerifyEmail({
      to: payload.to,
      verifyToken: payload.verifyToken,
      displayName: payload.displayName ?? '',
    });
  }
}
