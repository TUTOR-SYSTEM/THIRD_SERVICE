import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { SendMailOptions } from '@packages/interfaces';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly resetPasswordUrlBase: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('RESEND_API_KEY');
    this.from = this.configService.getOrThrow<string>('MAIL_FROM');
    this.resetPasswordUrlBase = this.configService.get<string>(
      'PASSWORD_RESET_URL_BASE',
      'http://localhost:3000',
    );
    this.resend = new Resend(apiKey);
  }

  async testSendEmailService() {
    return this.sendMail({
      to: 'dang04223@gmail.com',
      subject: 'test email sended ...',
      html: '',
      text: 'test email sended ...',
    });
  }

  async sendForgotPasswordMail(params: { to: string; resetToken: string; displayName: string }) {
    const resetUrl = `${this.resetPasswordUrlBase}/reset-password?token=${encodeURIComponent(params.resetToken)}`;

    return this.sendMail({
      to: params.to,
      subject: 'Reset your password',
      html: `<p>Hi ${escapeHtml(params.displayName)},</p><p>We received a request to reset your password. Click the link below to choose a new one:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 5 minutes. If you didn't request this, you can ignore this email.</p>`,
      text: `Hi ${params.displayName}, reset your password here: ${resetUrl} (expires in 5 minutes)`,
    });
  }

  private async sendMail(options: SendMailOptions) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        ...options,
      });

      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Mail sent: ${JSON.stringify(data)}`);

      return data;
    } catch (error) {
      this.logger.error('Failed to send mail', error);

      throw error;
    }
  }
}
