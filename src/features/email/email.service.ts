import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { SendMailOptions } from '@packages/interfaces';
import { renderPasswordResetOtpEmail } from './templates/password-reset-otp.template';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly resetPasswordUrlBase: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.getOrThrow<string>('SMTP_HOST');
    this.from = this.configService.getOrThrow<string>('MAIL_FROM');
    this.resetPasswordUrlBase = this.configService.get<string>(
      'PASSWORD_RESET_URL_BASE',
      'http://localhost:3000',
    );

    const port = Number(this.configService.get<string>('SMTP_PORT', '587'));
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('SMTP_PORT must be a positive integer');
    }
    const secure = this.configService.get<string>('SMTP_SECURE', port === 465 ? 'true' : 'false');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    if (!!user !== !!pass) {
      throw new Error('SMTP_USER and SMTP_PASS must be set together');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: secure === 'true',
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async testSendEmailService() {
    const to =
      this.configService.get<string>('TEST_EMAIL_RECIPIENT') || process.env.TEST_EMAIL_RECIPIENT;
    if (!to) {
      throw new HttpException(
        'TEST_EMAIL_RECIPIENT is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.sendMail({
      to,
      subject: 'test email sended ...',
      html: '',
      text: 'test email sended ...',
    });
  }

  /** Sends the 6-digit password-reset code. The code is never logged (see `sendMail`). */
  async sendPasswordResetOtpMail(params: { to: string; otp: string; displayName: string }) {
    const { html, text } = renderPasswordResetOtpEmail({
      otp: params.otp,
      displayName: params.displayName,
    });

    return this.sendMail({
      to: params.to,
      subject: `${params.otp} là mã đặt lại mật khẩu của bạn`,
      html,
      text,
    });
  }

  async sendVerifyEmail(params: { to: string; verifyToken: string; displayName: string }) {
    // Same FE base as the reset link (`PASSWORD_RESET_URL_BASE`), pointing at the verify-email page.
    const verifyUrl = `${this.resetPasswordUrlBase}/verify-email?token=${encodeURIComponent(params.verifyToken)}`;

    return this.sendMail({
      to: params.to,
      subject: 'Verify your email address',
      html: `<p>Hi ${escapeHtml(params.displayName)},</p><p>Thanks for signing up. Please confirm that this email address belongs to you by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
      text: `Hi ${params.displayName}, verify your email here: ${verifyUrl} (expires in 24 hours)`,
    });
  }

  private async sendMail(options: SendMailOptions) {
    try {
      // @types/nodemailer types sendMail's result as `any`; narrow it to the field we use.
      const info = (await this.transporter.sendMail({
        from: this.from,
        ...options,
      })) as { messageId: string };

      this.logger.log(`Mail sent: ${info.messageId}`);

      return { id: info.messageId };
    } catch (error) {
      this.logger.error('Failed to send mail', error);

      throw error;
    }
  }
}
