import {
  BadRequestException,
  ForbiddenException,
  Injectable, Logger,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import type {
  CreateNotificationDto,
  GetNotificationsQueryDto,
} from '@packages/entities/notification';
import { NotificationRepository } from './notification.repository';
import { checkUuidValid } from '@packages/helpers';

export type NotificationActor = { userId: string; role?: string };

/** Notification types each non-admin role may create. ADMIN may create all; others none. */
const CREATABLE_TYPES_BY_ROLE: Record<string, readonly string[]> = {
  TUTOR: ['TUTOR', 'STUDENT'],
};

/** ADMIN is not restricted to the caller's own rows. */
const scopeUserId = (actor: NotificationActor) => (actor.role === 'ADMIN' ? undefined : actor.userId);

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

  async createNotificationService(dto: CreateNotificationDto, role?: string) {
    if (role !== 'ADMIN' && !CREATABLE_TYPES_BY_ROLE[role ?? '']?.includes(dto.type)) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }

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

  async findById(id: string, actor: NotificationActor) {
    this.assertUuid(id);
    const note = await this.repo.findById(id, scopeUserId(actor));
    if (!note) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return note;
  }

  async markAsRead(id: string, actor: NotificationActor) {
    this.assertUuid(id);
    const note = await this.repo.markAsRead(id, scopeUserId(actor));
    if (!note) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return note;
  }

  async markAllAsRead(userId: string) {
    return this.repo.markAllAsRead(userId);
  }

  async delete(id: string, actor: NotificationActor) {
    this.assertUuid(id);
    const deleted = await this.repo.delete(id, scopeUserId(actor));
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return { id };
  }
}
