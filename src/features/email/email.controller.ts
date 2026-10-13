import { Controller, Get, UseGuards } from '@nestjs/common';
import { EmailService } from './email.service';
<<<<<<< Updated upstream
=======
import { Roles } from '@packages/decorators';
import { RolesGuard } from '@packages/guards';
>>>>>>> Stashed changes

// Sends a real email on every call, so it needs a valid JWT like every other non-health route.
@Controller('emails')
export class EmailController {
  constructor(private readonly email: EmailService) {}

<<<<<<< Updated upstream
=======
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
>>>>>>> Stashed changes
  @Get('')
  async testSendEmailController() {
    return await this.email.testSendEmailService();
  }
}
