import { createHash } from 'node:crypto';
import { Controller, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { ZodValidationPipe } from '@packages/pipes/zod-validation.pipe';
import { RedisService } from '../redis/redis.service';
import { EmailService } from './email.service';

/**
 * RPC payload for the password-reset code mail. `otp` is the 6-digit code minted by `user`, and
 * `to` must be a real address: without this, any publisher could make the configured `MAIL_FROM`
 * send mail to an arbitrary recipient (TRD3-15).
 */
const passwordResetOtpPayloadSchema = z.object({
  to: z.email().max(254),
  otp: z.string().regex(/^\d{6}$/),
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
 * RPC payload for the account-created mail (login credentials of an account an admin/tutor just
 * created). `to` is validated like the other mails (TRD3-15); the password is never logged.
 */
const accountCreatedPayloadSchema = z.object({
  to: z.email().max(254),
  email: z.email().max(254),
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(256),
  displayName: z.string().max(200).nullish(),
});

/**
 * RPC payload for the "this email already has an account" notice (F-09). `to` is the owner of the
 * registered address; the mail never contains a secret.
 */
const accountExistsPayloadSchema = z.object({
  to: z.email().max(254),
  email: z.email().max(254),
  displayName: z.string().max(200).nullish(),
});

/** Mails per recipient per hour, by kind (report F-07). Keys hold a digest of the address only. */
const MAIL_RATE_PER_HOUR = { otp: 5, verify: 10, account: 20, exists: 5 } as const;
const HOUR_SECONDS = 3600;

/**
 * Message-pattern mirror of `EmailController` — reached by the gateway's/`user`'s
 * `RmqProducer` over the `third_queue` RabbitMQ queue. Every `email.*` message must carry a valid
 * rpcSig (RpcSignatureInterceptor), so only a service holding RPC_ACTOR_SECRET can send mail.
 * Delegates to the same, unmodified `EmailService` the HTTP controller uses.
 */
@Controller()
export class EmailRpcController {
  constructor(
    private readonly emailService: EmailService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  @MessagePattern('email.test')
  testSendEmail() {
    return this.emailService.testSendEmailService();
  }

  @MessagePattern('email.sendPasswordResetOtp')
  async sendPasswordResetOtp(
    @Payload(new ZodValidationPipe(passwordResetOtpPayloadSchema))
    payload: z.infer<typeof passwordResetOtpPayloadSchema>,
  ) {
    await this.limitRecipient('otp', payload.to);
    return this.emailService.sendPasswordResetOtpMail({
      to: payload.to,
      otp: payload.otp,
      displayName: payload.displayName ?? '',
    });
  }

  @MessagePattern('email.sendAccountCreated')
  async sendAccountCreated(
    @Payload(new ZodValidationPipe(accountCreatedPayloadSchema))
    payload: z.infer<typeof accountCreatedPayloadSchema>,
  ) {
    await this.limitRecipient('account', payload.to);
    return this.emailService.sendAccountCreatedMail({
      to: payload.to,
      email: payload.email,
      username: payload.username,
      password: payload.password,
      displayName: payload.displayName ?? '',
    });
  }

  @MessagePattern('email.sendAccountExists')
  async sendAccountExists(
    @Payload(new ZodValidationPipe(accountExistsPayloadSchema))
    payload: z.infer<typeof accountExistsPayloadSchema>,
  ) {
    await this.limitRecipient('exists', payload.to);
    return this.emailService.sendAccountExistsMail({
      to: payload.to,
      email: payload.email,
      displayName: payload.displayName ?? '',
    });
  }

  @MessagePattern('email.sendVerifyEmail')
  async sendVerifyEmail(
    @Payload(new ZodValidationPipe(verifyEmailPayloadSchema))
    payload: z.infer<typeof verifyEmailPayloadSchema>,
  ) {
    await this.limitRecipient('verify', payload.to);
    return this.emailService.sendVerifyEmail({
      to: payload.to,
      verifyToken: payload.verifyToken,
      displayName: payload.displayName ?? '',
    });
  }

  /** Counts mails per recipient in a fixed hour window; refuses past the limit (429). */
  private async limitRecipient(kind: keyof typeof MAIL_RATE_PER_HOUR, to: string): Promise<void> {
    if (!this.redisService) return;
    const digest = createHash('sha256').update(to.trim().toLowerCase()).digest('hex');
    const count = await this.redisService.incrWithWindow(
      'mail-rate:' + kind + ':' + digest,
      HOUR_SECONDS,
    );
    if (count > MAIL_RATE_PER_HOUR[kind]) {
      throw new HttpException('Too many mails to this recipient', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
