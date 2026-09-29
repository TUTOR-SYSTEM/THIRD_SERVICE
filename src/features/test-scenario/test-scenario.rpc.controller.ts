import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateTestScenarioDto,
  GetTestScenariosQueryDto,
  UpdateTestScenarioDto,
} from '@packages/entities/test-scenario';
import { TestScenarioService } from './test-scenario.service';

/**
 * Reached only by the gateway's thin `test-scenarios` proxy controller over RabbitMQ.
 * No business logic here — everything is delegated to `TestScenarioService`.
 */
@Controller()
export class TestScenarioRpcController {
  constructor(private readonly service: TestScenarioService) {}

  @MessagePattern('testscenario.create')
  create(@Payload() dto: CreateTestScenarioDto) {
    return this.service.create(dto);
  }

  @MessagePattern('testscenario.list')
  list(@Payload() query: GetTestScenariosQueryDto) {
    return this.service.findAll(query);
  }

  @MessagePattern('testscenario.update')
  update(@Payload() payload: { id: string; dto: UpdateTestScenarioDto }) {
    return this.service.update(payload.id, payload.dto);
  }

  @MessagePattern('testscenario.delete')
  del(@Payload() payload: { id: string }) {
    return this.service.delete(payload.id);
  }

  @MessagePattern('testscenario.stats')
  stats() {
    return this.service.stats();
  }

  @MessagePattern('testscenario.run')
  run(
    @Payload() payload: { id: string; userId?: string; accessToken?: string; wait?: boolean },
  ) {
    return this.service.run(
      payload.id,
      { userId: payload.userId, accessToken: payload.accessToken },
      { wait: payload.wait },
    );
  }
}
