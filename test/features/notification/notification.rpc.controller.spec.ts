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
      Reflect.getMetadata(
        PATTERN_METADATA,
        NotificationRpcController.prototype[method as keyof NotificationRpcController],
      ),
    ).toEqual([pattern]);
  });

  it('create forwards the DTO including senderId to the validated service path', async () => {
    const dto = { type: 'SYSTEM', title: 't', content: 'c', senderId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', role: 'ADMIN' };
    service.createNotificationService.mockResolvedValue({ id: 'n' });

    await expect(controller.create(dto as never)).resolves.toEqual({ id: 'n' });
    expect(service.createNotificationService).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't', senderId: dto.senderId }),
      'ADMIN',
    );
  });

  it('getAll unpacks userId and query from the payload', async () => {
    service.findAll.mockResolvedValue({ data: [] });

    await controller.getAll({ userId: 'u', query: { page: 1, limit: 10 } as never });

    expect(service.findAll).toHaveBeenCalledWith('u', expect.objectContaining({ page: 1, limit: 10 }));
  });

  it('markAllAsRead, getById, markAsRead and del unpack their single field', async () => {
    service.markAllAsRead.mockResolvedValue({});
    service.findById.mockResolvedValue({ id: 'n' });
    service.markAsRead.mockResolvedValue({ id: 'n' });
    service.delete.mockResolvedValue({ id: 'n' });

    await controller.markAllAsRead({ userId: 'u' });
<<<<<<< Updated upstream
    await controller.getById({ id: 'n', userId: 'u' });
    await controller.markAsRead({ id: 'n', userId: 'u' });
    await controller.del({ id: 'n', userId: 'u' });

    expect(service.markAllAsRead).toHaveBeenCalledWith('u');
    // userId is forwarded so the service can scope the row to its owner (IDOR guard).
    expect(service.findById).toHaveBeenCalledWith('n', 'u');
    expect(service.markAsRead).toHaveBeenCalledWith('n', 'u');
    expect(service.delete).toHaveBeenCalledWith('n', 'u');
=======
    await controller.getById({ id: 'n', userId: 'u', role: 'STUDENT' });
    await controller.markAsRead({ id: 'n', userId: 'u', role: 'STUDENT' });
    await controller.del({ id: 'n', userId: 'u', role: 'STUDENT' });

    expect(service.markAllAsRead).toHaveBeenCalledWith('u');
    expect(service.findById).toHaveBeenCalledWith('n', { userId: 'u', role: 'STUDENT' });
    expect(service.markAsRead).toHaveBeenCalledWith('n', { userId: 'u', role: 'STUDENT' });
    expect(service.delete).toHaveBeenCalledWith('n', { userId: 'u', role: 'STUDENT' });
>>>>>>> Stashed changes
  });

  it('propagates NotFound from the service so the RPC filter can translate it', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    service.findById.mockRejectedValue(new NotFoundException('NOTIFICATION_NOT_FOUND'));

    await expect(controller.getById({ id: 'missing', userId: 'u', role: 'STUDENT' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getAll accepts a boolean isRead from the gateway', async () => {
    service.findAll.mockResolvedValue({});
    await controller.getAll({ userId: 'u', query: { isRead: true } } as never);
    expect(service.findAll.mock.calls.at(-1)?.[1]).toMatchObject({ isRead: true, page: 1, limit: 10 });
  });
});
