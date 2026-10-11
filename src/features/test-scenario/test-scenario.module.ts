import { Module } from '@nestjs/common';
import { TestAuthService } from './test-auth.service';
import { TestFixtureRepository } from './test-fixture.repository';
import { TestFixtureService } from './test-fixture.service';
import { TestScenarioRepository } from './test-scenario.repository';
import { TestScenarioRpcController } from './test-scenario.rpc.controller';
import { TestScenarioService } from './test-scenario.service';

@Module({
  controllers: [TestScenarioRpcController],
  providers: [
    TestScenarioService,
    TestScenarioRepository,
    TestAuthService,
    TestFixtureService,
    TestFixtureRepository,
  ],
})
export class TestScenarioModule {}
