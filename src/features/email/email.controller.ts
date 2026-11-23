import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { AdminRoleGuard } from '@packages/guards';

// Sends a real email on every call, so it is ADMIN only (JWT required).
@ApiTags('Email')
@ApiBearerAuth('access-token')
@UseGuards(AdminRoleGuard)
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get('test')
  async testSendEmailController() {
    return await this.email.testSendEmailService();
  }
}
