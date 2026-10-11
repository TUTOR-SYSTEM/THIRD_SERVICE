import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisRpcController } from './redis.rpc.controller';

@Global()
@Module({
  controllers: [RedisRpcController],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
