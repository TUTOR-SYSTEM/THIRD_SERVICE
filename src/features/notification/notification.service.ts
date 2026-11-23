import { withDetailUrl } from './notification.detail-url';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
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
    if (role === 'STUDENT') return this.createStudentToTutorNotification(dto);

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

    if (role !== 'ADMIN') {
      await this.assertTutorCanNotify(dto);
    }

    const recipientIds = await this.resolveRecipientIds(dto);
    if (recipientIds.length === 0) {
      // Nobody to address (e.g. an empty class): keep the row, visible to the sender only.
      return this.repo.create({ ...dto, userId: null });
    }
    const [first] = await this.repo.createMany(recipientIds.map((userId) => ({ ...dto, userId })));
    return first;
  }

  /**
   * STUDENT may create exactly one kind: a `TUTOR` notification addressed (userId) to a tutor who
   * teaches them (e.g. "student submitted an exercise"). No classId/studentId fan-out allowed.
   */
  private async createStudentToTutorNotification(dto: CreateNotificationDto) {
    if (dto.type !== 'TUTOR' || dto.classId || dto.studentId) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
    if (!dto.senderId || !checkUuidValid({ data: dto.senderId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_NOT_VALID);
    }
    if (!dto.userId || !checkUuidValid({ data: dto.userId })) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
    if (!(await this.repo.tutorTeachesStudent(dto.senderId, dto.userId))) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
    const [first] = await this.repo.createMany([dto]);
    return first;
  }

  /**
   * A TUTOR may only notify students of classes they teach: `classId` must be their class, and
   * every `studentId` / `userId` must be enrolled in one of their classes. ADMIN is not checked here.
   */
  private async assertTutorCanNotify(dto: CreateNotificationDto): Promise<void> {
    const tutorId = dto.senderId as string;
    if (!dto.classId && !dto.studentId && !dto.userId) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
    if (dto.classId && !(await this.repo.tutorOwnsClass(dto.classId, tutorId))) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
    for (const studentId of [dto.studentId, dto.userId]) {
      if (studentId && !(await this.repo.tutorTeachesStudent(studentId, tutorId))) {
        throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
      }
    }
  }

  /** Every user that should receive the notification, de-duplicated. */
  private async resolveRecipientIds(dto: CreateNotificationDto): Promise<string[]> {
    const ids = new Set<string>();
    if (dto.userId) ids.add(dto.userId);
    if (dto.studentId) ids.add(dto.studentId);
    if (dto.classId) {
      for (const studentId of await this.repo.studentIdsOfClass(dto.classId)) ids.add(studentId);
    }
    return [...ids];
  }

  async findAll(userId: string, query: GetNotificationsQueryDto) {
    const result = await this.repo.findAll(userId, query);
    return { ...result, data: result.data.map(withDetailUrl) };
  }

  async findById(id: string, actor: NotificationActor) {
    this.assertUuid(id);
    // Detail is recipient-only (even for ADMIN): other users' notifications are 404.
    const note = await this.repo.findById(id, actor.userId);
    if (!note) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return withDetailUrl(note);
  }

  async markAsRead(id: string, actor: NotificationActor) {
    this.assertUuid(id);
    // Recipient-only (even for ADMIN): only the recipient manages read/delete state.
    const note = await this.repo.markAsRead(id, actor.userId);
    if (!note) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return withDetailUrl(note);
  }

  async markAllAsRead(userId: string) {
    return this.repo.markAllAsRead(userId);
  }

  async delete(id: string, actor: NotificationActor) {
    this.assertUuid(id);
    // Recipient-only (even for ADMIN): only the recipient deletes their notification.
    const deleted = await this.repo.delete(id, actor.userId);
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.NOTIFICATION_NOT_FOUND);
    return { id };
  }
}
