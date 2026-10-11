import { LogService } from 'src/features/log/log.service';
import type { LogRepository } from 'src/features/log/log.repository';
import type { LogGateway } from 'src/features/log/log.gateway';

describe('LogService', () => {
  const repo = { create: jest.fn(), findAll: jest.fn(), findByCorrelationId: jest.fn(), statsByEndpoint: jest.fn() };
  const gateway = { emitNewLog: jest.fn() };
  const service = new LogService(repo as unknown as LogRepository, gateway as unknown as LogGateway);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('createInternal persists the row and then pushes it to the live admin feed', async () => {
    const row = { id: 1, path: '/x' };
    repo.create.mockResolvedValue(row);

    await service.createInternal({ path: '/x' } as never);

    expect(repo.create).toHaveBeenCalledWith({ path: '/x' });
    expect(gateway.emitNewLog).toHaveBeenCalledWith(row);
  });

  it('createInternal does not emit when the insert fails', async () => {
    repo.create.mockRejectedValue(new Error('insert failed'));

    await expect(service.createInternal({} as never)).resolves.toBeUndefined();
    expect(gateway.emitNewLog).not.toHaveBeenCalled();
    expect(service['logger'].warn).toHaveBeenCalledWith(expect.stringContaining('insert failed'));
  });

  it('createInternal does not throw if the socket emit fails after a successful insert', async () => {
    repo.create.mockResolvedValue({ id: 2 });
    gateway.emitNewLog.mockImplementation(() => {
      throw new Error('socket closed');
    });

    await expect(service.createInternal({} as never)).resolves.toBeUndefined();
    expect(service['logger'].warn).toHaveBeenCalledWith(expect.stringContaining('socket closed'));
  });

  it('findAll, findByCorrelationId and stats delegate to the repository', async () => {
    repo.findAll.mockResolvedValue({ data: [] });
    repo.findByCorrelationId.mockResolvedValue([{ id: 1 }]);
    repo.statsByEndpoint.mockResolvedValue([{ endpoint: 'GET /x', count: 3 }]);

    await expect(service.findAll({ page: 1 } as never)).resolves.toEqual({ data: [] });
    await expect(service.findByCorrelationId('c1')).resolves.toEqual([{ id: 1 }]);
    await expect(service.stats()).resolves.toEqual([{ endpoint: 'GET /x', count: 3 }]);
    expect(repo.findByCorrelationId).toHaveBeenCalledWith('c1');
  });
});

describe('LogService.createInternal failure modes', () => {
  const repo = { create: jest.fn(), findAll: jest.fn(), findByCorrelationId: jest.fn(), statsByEndpoint: jest.fn() };
  const gateway = { emitNewLog: jest.fn() };
  const service = new LogService(repo as unknown as LogRepository, gateway as unknown as LogGateway);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('logs the string form of a non-Error insert failure', async () => {
    repo.create.mockRejectedValue('driver said no');
    await expect(service.createInternal({} as never)).resolves.toBeUndefined();
    expect(service['logger'].warn).toHaveBeenCalledWith('Failed to persist request log: driver said no');
    expect(gateway.emitNewLog).not.toHaveBeenCalled();
  });

  it('propagates repository read errors unchanged (no swallowing on the query path)', async () => {
    repo.findAll.mockRejectedValue(new Error('read failed'));
    await expect(service.findAll({ page: 1 } as never)).rejects.toThrow('read failed');
  });
});
