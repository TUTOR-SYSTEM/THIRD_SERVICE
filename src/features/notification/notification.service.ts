import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import type {
  CreateNotificationDto,
  GetNotificationsQueryDto,
} from '@packages/entities/notification';
import { NotificationRepository } from './notification.repository';
import { checkUuidValid } from '@packages/helpers';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(private readonly repo: NotificationRepository) {}

  /** Internal fire-and-forget — skips validation, called from other services. */
  async createInternal(dto: CreateNotificationDto): Promise<void> {
    try {
      await this.repo.create(dto);
    } catch (err) {
      this.logger.warn(
        `Failed to create notification: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private assertUuid(id: string): void {
    if (!id || !checkUuidValid({ data: id })) {
      throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    }
  }

  async createNotificationService(dto: CreateNotificationDto) {
    if (!dto.senderId || (dto.senderId && !checkUuidValid({ data: dto.senderId }))) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_NOT_VALID);
    }

    if (dto.classId && !checkUuidValid({ data: dto.classId })) {
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_NOT_VALID);
    }

    if (dto.studentId && !checkUuidValid({ data: dto.studentId })) {
      throw new BadRequestException(ERROR_MESSAGES.STUDENT_ID_NOT_VALID);
    }
    return this.repo.create(dto);
  }

  async findAll(userId: string, query: GetNotificationsQueryDto) {
    return this.repo.findAll(userId, query);
  }

  /** `userId` scopes the lookup to rows the caller received or sent (404 otherwise). */
  async findById(id: string, userId?: string) {
    this.assertUuid(id);
    const note = await this.repo.findById(id, userId);
    if (!note) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return note;
  }

  async markAsRead(id: string, userId?: string) {
    this.assertUuid(id);
    const note = await this.repo.markAsRead(id, userId);
    if (!note) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return note;
  }

  async markAllAsRead(userId: string) {
    return this.repo.markAllAsRead(userId);
  }

  async delete(id: string, userId?: string) {
    this.assertUuid(id);
    const deleted = await this.repo.delete(id, userId);
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return { id };
  }
}
