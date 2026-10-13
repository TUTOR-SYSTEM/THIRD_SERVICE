import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  bulkCreateTestScenariosSchema,
  createTestFixtureSchema,
  createTestScenarioSchema,
  generateTestScenariosSchema,
  getTestScenariosQuerySchema,
  idPayloadSchema,
  resolveFixturePayloadSchema,
  runsPayloadSchema,
  runTestScenarioPayloadSchema,
  updateTestFixturePayloadSchema,
  updateTestScenarioPayloadSchema,
} from '@packages/entities/test-scenario';
import { ZodValidationPipe } from '@packages/pipes';
import type {
  CreateTestFixtureDto,
  CreateTestScenarioDto,
  GenerateScenariosDto,
  GetTestScenariosQueryDto,
  UpdateTestFixtureDto,
  UpdateTestScenarioDto,
} from '@packages/entities/test-scenario';
import { TestAuthService } from './test-auth.service';
import { TestFixtureService } from './test-fixture.service';
import { TestScenarioService } from './test-scenario.service';

/**
 * Reached only by the gateway's thin `test-scenarios` proxy controller over RabbitMQ.
 * No business logic here — everything is delegated to `TestScenarioService`.
 */
@Controller()
export class TestScenarioRpcController {
  constructor(
    private readonly service: TestScenarioService,
    private readonly fixtures: TestFixtureService,
    private readonly auth: TestAuthService,
  ) {}

  @MessagePattern('testscenario.create')
  create(@Payload(new ZodValidationPipe(createTestScenarioSchema)) dto: CreateTestScenarioDto) {
    return this.service.create(dto);
  }

  @MessagePattern('testscenario.list')
  list(
    @Payload(new ZodValidationPipe(getTestScenariosQuerySchema)) query: GetTestScenariosQueryDto,
  ) {
    return this.service.findAll(query);
  }

  @MessagePattern('testscenario.update')
  update(
    @Payload(new ZodValidationPipe(updateTestScenarioPayloadSchema))
    payload: {
      id: string;
      dto: UpdateTestScenarioDto;
    },
  ) {
    return this.service.update(payload.id, payload.dto);
  }

  @MessagePattern('testscenario.delete')
  del(@Payload(new ZodValidationPipe(idPayloadSchema)) payload: { id: string }) {
    return this.service.delete(payload.id);
  }

  @MessagePattern('testscenario.stats')
  stats() {
    return this.service.stats();
  }

  @MessagePattern('testscenario.runs')
  runs(@Payload(new ZodValidationPipe(runsPayloadSchema)) payload: { id: string; limit?: number }) {
    return this.service.findRuns(payload.id, payload.limit);
  }

  @MessagePattern('testscenario.run')
  run(
    @Payload(new ZodValidationPipe(runTestScenarioPayloadSchema))
    payload: {
      id: string;
      userId?: string;
      accessToken?: string;
      wait?: boolean;
    },
  ) {
    return this.service.run(
      payload.id,
      { userId: payload.userId, accessToken: payload.accessToken },
      { wait: payload.wait },
    );
  }

  @MessagePattern('testscenario.generate')
  generate(@Payload(new ZodValidationPipe(generateTestScenariosSchema)) dto: GenerateScenariosDto) {
    return this.service.generate(dto);
  }

  @MessagePattern('testscenario.createMany')
  createMany(
    @Payload(new ZodValidationPipe(bulkCreateTestScenariosSchema))
    payload: {
      scenarios: CreateTestScenarioDto[];
    },
  ) {
    return this.service.createMany(payload.scenarios);
  }

  @MessagePattern('testscenario.authprofiles')
  authProfiles() {
    return this.auth.statuses();
  }

  @MessagePattern('testscenario.fixtures.list')
  listFixtures() {
    return this.fixtures.findAll();
  }

  @MessagePattern('testscenario.fixtures.create')
  createFixture(
    @Payload(new ZodValidationPipe(createTestFixtureSchema)) dto: CreateTestFixtureDto,
  ) {
    return this.fixtures.create(dto);
  }

  @MessagePattern('testscenario.fixtures.update')
  updateFixture(
    @Payload(new ZodValidationPipe(updateTestFixturePayloadSchema))
    payload: {
      id: string;
      dto: UpdateTestFixtureDto;
    },
  ) {
    return this.fixtures.update(payload.id, payload.dto);
  }

  @MessagePattern('testscenario.fixtures.delete')
  deleteFixture(@Payload(new ZodValidationPipe(idPayloadSchema)) payload: { id: string }) {
    return this.fixtures.delete(payload.id);
  }

  @MessagePattern('testscenario.fixtures.resolve')
  resolveFixture(
    @Payload(new ZodValidationPipe(resolveFixturePayloadSchema))
    payload: {
      id: string;
      accessToken?: string;
    },
  ) {
    return this.fixtures.resolve(payload.id, payload.accessToken);
  }
}
