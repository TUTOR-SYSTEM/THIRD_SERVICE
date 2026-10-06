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

  async findById(id: string) {
    const note = await this.repo.findById(id);
    if (!note) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return note;
  }

  async markAsRead(id: string) {
    const note = await this.repo.markAsRead(id);
    if (!note) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return note;
  }

  async markAllAsRead(userId: string) {
    return this.repo.markAllAsRead(userId);
  }

  async delete(id: string) {
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return { id };
  }
}
