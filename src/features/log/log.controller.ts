import { Controller, Get, HttpCode, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { ZodValidationPipe } from '@packages/pipes';
import { Roles } from '@packages/decorators';
import { RolesGuard } from '@packages/guards';
import {
  getRequestLogsQuerySchema,
  type GetRequestLogsQueryDto,
} from '@packages/entities/log';
import { LogService } from './log.service';

/** Admin-only: lets an operator check request traffic across all microservices from one table. */
@ApiTags('Logs')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles('ADMIN')
@Controller('logs')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @Get()
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'List request logs across all services (admin only)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'serviceName', required: false, type: String, example: 'gateway' })
  @ApiQuery({ name: 'type', required: false, enum: ['HTTP', 'RPC'] })
  @ApiQuery({ name: 'correlationId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by path' })
  @SwaggerResponse({ status: 200, description: 'Request logs fetched' })
  async findAll(
    @Query(new ZodValidationPipe<GetRequestLogsQueryDto>(getRequestLogsQuerySchema))
    query: GetRequestLogsQueryDto,
  ) {
    return this.logService.findAll(query);
  }

  @Get('trace/:correlationId')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Trace one request across every service',
    description: 'Every log row sharing the same correlationId, ordered by when it happened.',
  })
  @ApiParam({ name: 'correlationId', type: String })
  @SwaggerResponse({ status: 200, description: 'Trace fetched' })
  async trace(@Param('correlationId') correlationId: string) {
    return this.logService.findByCorrelationId(correlationId);
  }

  @Get('stats')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Per-endpoint stats over the last 24h (admin only)',
    description: 'Grouped by (method, path): calls/24h, error count/24h, P95 duration.',
  })
  @SwaggerResponse({ status: 200, description: 'Endpoint stats fetched' })
  async stats() {
    return this.logService.stats();
  }
}
