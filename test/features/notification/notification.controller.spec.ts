import { Reflector } from '@nestjs/core';
import { UnprocessableEntityException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { ZodValidationPipe } from '@packages/pipes';
import { createNotificationSchema, getNotificationsQuerySchema } from '@packages/entities/notification';
import { NotificationController } from 'src/features/notification/notification.controller';
import { NotificationService } from 'src/features/notification/notification.service';

const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const user = { id: USER_ID } as never;

describe('NotificationController (HTTP)', () => {
  const service = {
    createNotificationService: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    delete: jest.fn(),
  };
  const controller = new NotificationController(service as unknown as NotificationService);

  beforeEach(() => jest.clearAllMocks());

  describe('auth', () => {
    it('no route is @Public, so every notification endpoint requires a JWT', () => {
      const reflector = new Reflector();
      for (const handler of [
        NotificationController.prototype.create,
        NotificationController.prototype.findAll,
        NotificationController.prototype.findById,
        NotificationController.prototype.markAsRead,
        NotificationController.prototype.markAllAsRead,
        NotificationController.prototype.delete,
      ]) {
        expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
      }
    });
  });

  describe('POST / validation matrix', () => {
    const pipe = new ZodValidationPipe(createNotificationSchema);
    const valid = { type: 'SYSTEM', title: 'Hi', content: 'Body' };

    it('accepts a minimal valid body', () => {
      expect(pipe.transform(valid)).toMatchObject(valid);
    });

    it.each([
      ['unknown type', { ...valid, type: 'SPAM' }, 'type'],
      ['missing title', { ...valid, title: undefined }, 'title'],
      ['empty title', { ...valid, title: '' }, 'title'],
      ['title over 255 chars', { ...valid, title: 'x'.repeat(256) }, 'title'],
      ['missing content', { ...valid, content: undefined }, 'content'],
      ['non-uuid userId', { ...valid, userId: 'abc' }, 'userId'],
      ['unknown actionType', { ...valid, actionType: 'DELETE' }, 'actionType'],
      ['redirectUrl over 500 chars', { ...valid, redirectUrl: 'x'.repeat(501) }, 'redirectUrl'],
    ])('rejects %s with 422 and names the field', (_label, body, field) => {
      try {
        pipe.transform(body);
        throw new Error('expected validation to fail');
      } catch (err) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        const response = (err as UnprocessableEntityException).getResponse() as { errors: { field: string }[] };
        expect(response.errors.map((e) => e.field)).toContain(field);
      }
    });

    it('create forces senderId from the authenticated user, ignoring any client-supplied value', async () => {
      service.createNotificationService.mockResolvedValue({ id: 'n1' });

      await controller.create(user, { ...valid, senderId: 'spoofed-by-client' } as never);

      expect(service.createNotificationService).toHaveBeenCalledWith(
        expect.objectContaining({ senderId: USER_ID }),
      );
    });
  });

  describe('GET / query matrix', () => {
    const pipe = new ZodValidationPipe(getNotificationsQuerySchema);

    it('applies defaults page=1 and limit=10 when the query is empty', () => {
      expect(pipe.transform({})).toEqual({ page: 1, limit: 10 });
    });

    it('coerces numeric strings from the query string', () => {
      expect(pipe.transform({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 });
    });

    it.each([
      ['page=0', { page: '0' }],
      ['limit=101', { limit: '101' }],
      ['limit=abc', { limit: 'abc' }],
      ['type=NOPE', { type: 'NOPE' }],
    ])('rejects %s', (_label, query) => {
      expect(() => pipe.transform(query)).toThrow(UnprocessableEntityException);
    });

    it('findAll passes the current user id and parsed query to the service', async () => {
      service.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll(user, { page: 1, limit: 10, search: 'x' } as never);

      expect(service.findAll).toHaveBeenCalledWith(USER_ID, { page: 1, limit: 10, search: 'x' });
    });
  });

  describe('other routes delegate to the service', () => {
    it('GET /:id, PATCH /:id/read and DELETE /:id pass the id through', async () => {
      service.findById.mockResolvedValue({ id: 'n' });
      service.markAsRead.mockResolvedValue({ id: 'n', isRead: true });
      service.delete.mockResolvedValue({ id: 'n' });

      await expect(controller.findById('n')).resolves.toEqual({ id: 'n' });
      await expect(controller.markAsRead('n')).resolves.toEqual({ id: 'n', isRead: true });
      await expect(controller.delete('n')).resolves.toEqual({ id: 'n' });
    });

    it('PATCH /read-all marks only the current user\'s notifications', async () => {
      service.markAllAsRead.mockResolvedValue({ count: 2 });

      await controller.markAllAsRead(user);

      expect(service.markAllAsRead).toHaveBeenCalledWith(USER_ID);
    });
  });
});
