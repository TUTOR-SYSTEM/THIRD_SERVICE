import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { NotificationService } from 'src/features/notification/notification.service';
import type { NotificationRepository } from 'src/features/notification/notification.repository';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const dto = (overrides: Record<string, unknown> = {}) =>
  ({ type: 'SYSTEM', title: 't', content: 'c', senderId: ID, ...overrides }) as never;

describe('NotificationService', () => {
  const repo = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    delete: jest.fn(),
  };
  const service = new NotificationService(repo as unknown as NotificationRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  describe('createNotificationService (validated path)', () => {
    it('persists a notification whose ids are all valid UUIDs', async () => {
      repo.create.mockResolvedValue({ id: 'n1' });
      const input = dto({ userId: OTHER, classId: OTHER, studentId: OTHER });

      await expect(service.createNotificationService(input)).resolves.toEqual({ id: 'n1' });
      expect(repo.create).toHaveBeenCalledWith(input);
    });

    it('rejects a missing senderId with USER_ID_NOT_VALID and does not write', async () => {
      await expect(service.createNotificationService(dto({ senderId: undefined }))).rejects.toMatchObject({
        message: ERROR_MESSAGES.USER_ID_NOT_VALID,
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a malformed senderId', async () => {
      await expect(service.createNotificationService(dto({ senderId: 'not-a-uuid' }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it.each([
      ['classId', ERROR_MESSAGES.CLASS_ID_NOT_VALID],
      ['studentId', ERROR_MESSAGES.STUDENT_ID_NOT_VALID],
    ])('rejects a malformed %s with its specific error code', async (field, code) => {
      await expect(service.createNotificationService(dto({ [field]: '123' }))).rejects.toMatchObject({
        message: code,
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('allows optional FK ids to be absent', async () => {
      repo.create.mockResolvedValue({ id: 'n2' });

      await expect(service.createNotificationService(dto({ classId: null, studentId: undefined }))).resolves.toEqual({
        id: 'n2',
      });
    });
  });

  describe('createInternal (fire-and-forget path)', () => {
    it('writes through the repository', async () => {
      repo.create.mockResolvedValue({});

      await expect(service.createInternal(dto())).resolves.toBeUndefined();
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('swallows repository failures and logs a warning instead of throwing', async () => {
      repo.create.mockRejectedValue(new Error('db down'));

      await expect(service.createInternal(dto())).resolves.toBeUndefined();
      expect(service['logger'].warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });
  });

  describe('reads and updates', () => {
    it('findAll forwards the owner and query to the repository unchanged', async () => {
      const query = { page: 2, limit: 5, search: 'x', isRead: false };
      repo.findAll.mockResolvedValue({ data: [], pagination: {} });

      await service.findAll(ID, query as never);

      expect(repo.findAll).toHaveBeenCalledWith(ID, query);
    });

    it('findById returns the row when it exists', async () => {
      repo.findById.mockResolvedValue({ id: ID });

      await expect(service.findById(ID)).resolves.toEqual({ id: ID });
    });

    it('findById throws NotFound when the row is missing', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.findById(ID)).rejects.toThrow(NotFoundException);
    });

    it('markAsRead returns the updated row', async () => {
      repo.markAsRead.mockResolvedValue({ id: ID, isRead: true });

      await expect(service.markAsRead(ID)).resolves.toEqual({ id: ID, isRead: true });
    });

    it('markAsRead throws NotFound when no row matched', async () => {
      repo.markAsRead.mockResolvedValue(null);

      await expect(service.markAsRead(ID)).rejects.toThrow(NotFoundException);
    });

    it('markAllAsRead is scoped to the user and returns the repository result', async () => {
      repo.markAllAsRead.mockResolvedValue({ rowCount: 3 });

      await expect(service.markAllAsRead(ID)).resolves.toEqual({ rowCount: 3 });
      expect(repo.markAllAsRead).toHaveBeenCalledWith(ID);
    });

    it('delete returns the id on success', async () => {
      repo.delete.mockResolvedValue(true);

      await expect(service.delete(ID)).resolves.toEqual({ id: ID });
    });

    it('delete throws NotFound when nothing was deleted', async () => {
      repo.delete.mockResolvedValue(false);

      await expect(service.delete(ID)).rejects.toThrow(NotFoundException);
    });
  });
});

describe('NotificationService.createInternal failure modes', () => {
  it('swallows a non-Error rejection and logs its string form', async () => {
    const repo = { create: jest.fn().mockRejectedValue('plain failure') };
    const service = new NotificationService(repo as unknown as NotificationRepository);
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    await expect(service.createInternal({} as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Failed to create notification: plain failure');
  });

  it('does not reject when the repository throws synchronously', async () => {
    const repo = {
      create: jest.fn(() => {
        throw new Error('sync boom');
      }),
    };
    const service = new NotificationService(repo as unknown as NotificationRepository);
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    await expect(service.createInternal({} as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Failed to create notification: sync boom');
  });
});
