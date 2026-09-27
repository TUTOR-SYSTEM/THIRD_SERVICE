import { Module } from '@nestjs/common';
import { LogController } from './log.controller';
import { LogRpcController } from './log.rpc.controller';
import { LogRepository } from './log.repository';
import { LogService } from './log.service';

@Module({
  imports: [],
  controllers: [LogController, LogRpcController],
  providers: [LogService, LogRepository],
  exports: [LogService],
})
export class LogModule {}
