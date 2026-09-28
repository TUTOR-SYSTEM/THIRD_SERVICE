import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LogController } from './log.controller';
import { LogGateway } from './log.gateway';
import { LogRpcController } from './log.rpc.controller';
import { LogRepository } from './log.repository';
import { LogService } from './log.service';

@Module({
  // No secret registered here — `LogGateway` passes the secret explicitly to `jwtService.verify()`
  // (same as `JwtAuthGuard`), so a bare `JwtModule.register({})` is enough to get `JwtService`.
  imports: [JwtModule.register({})],
  controllers: [LogController, LogRpcController],
  providers: [LogService, LogRepository, LogGateway],
  exports: [LogService],
})
export class LogModule {}
