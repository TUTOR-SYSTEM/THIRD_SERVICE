import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisRpcController } from './redis.rpc.controller';
import { RedisController } from './redis.controller';

@Global()
@Module({
  controllers: [RedisController, RedisRpcController],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
