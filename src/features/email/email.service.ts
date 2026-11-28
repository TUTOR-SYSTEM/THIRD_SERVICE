import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { SendMailOptions } from '@packages/interfaces';
import { renderPasswordResetOtpEmail } from './templates/password-reset-otp.template';
import { renderAccountCreatedEmail } from './templates/account-created.template';
import { renderAccountExistsEmail } from './templates/account-exists.template';

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

    if (
      process.env.NODE_ENV === 'production' &&
      !this.configService.get<string>('PASSWORD_RESET_URL_BASE')
    ) {
      this.logger.warn('PASSWORD_RESET_URL_BASE is unset: verify-email links point at localhost');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: secure === 'true',
      // Mail (OTP codes, passwords) must never go out in clear text: refuse to continue without
      // STARTTLS unless SMTP_REQUIRE_TLS=false (local relays without TLS).
      requireTLS: secure !== 'true' && process.env.SMTP_REQUIRE_TLS !== 'false',
      auth: user && pass ? { user, pass } : undefined,
      // Bounded so a dead SMTP host cannot hold an RPC caller for minutes.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
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
      // The code is not put in the subject: subjects show in mail lists and notifications.
      subject: 'Mã đặt lại mật khẩu của bạn',
      html,
      text,
    });
  }

  /**
   * Sends login credentials to a newly created account. The password is put in the body only: never
   * in the subject, and never logged (see `sendMail`).
   */
  async sendAccountCreatedMail(params: {
    to: string;
    displayName: string;
    email: string;
    username: string;
    password: string;
  }) {
    const { html, text } = renderAccountCreatedEmail({
      displayName: params.displayName,
      email: params.email,
      username: params.username,
      password: params.password,
      loginUrl: `${this.resetPasswordUrlBase}/login`,
    });

    return this.sendMail({
      to: params.to,
      subject: 'Tài khoản của bạn đã được tạo',
      html,
      text,
    });
  }

  /** Tells the owner of an address that a sign-up was attempted with it (F-09). No secret in the mail. */
  async sendAccountExistsMail(params: { to: string; displayName: string; email: string }) {
    const { html, text } = renderAccountExistsEmail({
      displayName: params.displayName,
      email: params.email,
      loginUrl: `${this.resetPasswordUrlBase}/login`,
    });

    return this.sendMail({
      to: params.to,
      subject: 'Email của bạn đã có tài khoản',
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
      html: `<p>Hi ${escapeHtml(params.displayName)},</p><p>Thanks for signing up. Please confirm that this email address belongs to you by clicking the link below:</p><p><a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p><p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
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
