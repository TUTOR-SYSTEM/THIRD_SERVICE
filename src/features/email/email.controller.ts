import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { Public } from '@packages/decorators';

// Sends a real email on every call. Currently @Public() (no access token) per the user's request.
@ApiTags('Email')
@Public()
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get('test')
  async testSendEmailController() {
    return await this.email.testSendEmailService();
  }
}
