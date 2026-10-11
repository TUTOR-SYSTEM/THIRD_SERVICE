import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { NotificationRpcController } from 'src/features/notification/notification.rpc.controller';
import { NotificationService } from 'src/features/notification/notification.service';

describe('NotificationRpcController', () => {
  const service = {
    createNotificationService: jest.fn(),
    findAll: jest.fn(),
    markAllAsRead: jest.fn(),
    findById: jest.fn(),
    markAsRead: jest.fn(),
    delete: jest.fn(),
  };
  const controller = new NotificationRpcController(service as unknown as NotificationService);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['notification.create', 'create'],
    ['notification.getAll', 'getAll'],
    ['notification.markAllAsRead', 'markAllAsRead'],
    ['notification.getById', 'getById'],
    ['notification.markAsRead', 'markAsRead'],
    ['notification.delete', 'del'],
  ])('exposes %s on %s', (pattern, method) => {
    expect(
      Reflect.getMetadata(PATTERN_METADATA, NotificationRpcController.prototype[method as keyof NotificationRpcController]),
    ).toEqual([pattern]);
  });

  it('create forwards the DTO including senderId to the validated service path', async () => {
    const dto = { type: 'SYSTEM', title: 't', content: 'c', senderId: 'u' };
    service.createNotificationService.mockResolvedValue({ id: 'n' });

    await expect(controller.create(dto as never)).resolves.toEqual({ id: 'n' });
    expect(service.createNotificationService).toHaveBeenCalledWith(dto);
  });

  it('getAll unpacks userId and query from the payload', async () => {
    service.findAll.mockResolvedValue({ data: [] });

    await controller.getAll({ userId: 'u', query: { page: 1, limit: 10 } as never });

    expect(service.findAll).toHaveBeenCalledWith('u', { page: 1, limit: 10 });
  });

  it('markAllAsRead, getById, markAsRead and del unpack their single field', async () => {
    service.markAllAsRead.mockResolvedValue({});
    service.findById.mockResolvedValue({ id: 'n' });
    service.markAsRead.mockResolvedValue({ id: 'n' });
    service.delete.mockResolvedValue({ id: 'n' });

    await controller.markAllAsRead({ userId: 'u' });
    await controller.getById({ id: 'n' });
    await controller.markAsRead({ id: 'n' });
    await controller.del({ id: 'n' });

    expect(service.markAllAsRead).toHaveBeenCalledWith('u');
    expect(service.findById).toHaveBeenCalledWith('n');
    expect(service.markAsRead).toHaveBeenCalledWith('n');
    expect(service.delete).toHaveBeenCalledWith('n');
  });

  it('propagates NotFound from the service so the RPC filter can translate it', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    service.findById.mockRejectedValue(new NotFoundException('NOTIFICATION_NOT_FOUND'));

    await expect(controller.getById({ id: 'missing' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
