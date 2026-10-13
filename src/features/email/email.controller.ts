import { Controller, Get, UseGuards } from '@nestjs/common';
import { EmailService } from './email.service';
import { Roles } from '@packages/decorators';
import { RolesGuard } from '@packages/guards';

// Sends a real email on every call, so it needs a valid JWT like every other non-health route.
@Controller('emails')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  @Get('')
  async testSendEmailController() {
    return await this.email.testSendEmailService();
  }
}
