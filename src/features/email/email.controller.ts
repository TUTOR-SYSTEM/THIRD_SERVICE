import { Controller, Get } from '@nestjs/common';
import { EmailService } from './email.service';

// Sends a real email on every call, so it needs a valid JWT like every other non-health route.
@Controller('emails')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get('')
  async testSendEmailController() {
    return await this.email.testSendEmailService();
  }
}
