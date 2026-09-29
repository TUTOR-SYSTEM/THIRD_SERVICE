import { Module } from '@nestjs/common';
import { TestScenarioRepository } from './test-scenario.repository';
import { TestScenarioRpcController } from './test-scenario.rpc.controller';
import { TestScenarioService } from './test-scenario.service';

@Module({
  controllers: [TestScenarioRpcController],
  providers: [TestScenarioService, TestScenarioRepository],
})
export class TestScenarioModule {}
