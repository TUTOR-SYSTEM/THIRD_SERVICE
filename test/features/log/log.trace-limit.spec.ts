import { BadRequestException } from '@nestjs/common';
import { LogRpcController } from 'src/features/log/log.rpc.controller';
import { LogService } from 'src/features/log/log.service';

describe('log.trace limit', () => {
  let service: { findByCorrelationId: jest.Mock };
  let rpc: LogRpcController;

  beforeEach(() => {
    service = { findByCorrelationId: jest.fn().mockResolvedValue([]) };
    rpc = new LogRpcController(service as unknown as LogService);
  });

  it('defaults to 500 rows when no limit is sent', async () => {
    await rpc.trace({ correlationId: 'c-1' } as never);
    expect(service.findByCorrelationId).toHaveBeenCalledWith('c-1', 500);
  });

  it('passes a validated limit through to the service', async () => {
    await rpc.trace({ correlationId: 'c-1', limit: 50 } as never);
    expect(service.findByCorrelationId).toHaveBeenCalledWith('c-1', 50);
  });

  it('accepts the maximum of 1000', async () => {
    await rpc.trace({ correlationId: 'c-1', limit: 1000 } as never);
    expect(service.findByCorrelationId).toHaveBeenCalledWith('c-1', 1000);
  });

  it('rejects a limit above 1000 or below 1 without querying', async () => {
    expect(() => rpc.trace({ correlationId: 'c-1', limit: 1001 } as never)).toThrow(
      BadRequestException,
    );
    expect(() => rpc.trace({ correlationId: 'c-1', limit: 0 } as never)).toThrow(
      BadRequestException,
    );
    expect(service.findByCorrelationId).not.toHaveBeenCalled();
  });
});
