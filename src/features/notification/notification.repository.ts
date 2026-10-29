import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { classes, classStudents, notifications } from '../../database/schema';
import { escapeLike } from '@packages/helpers';
import type {
  CreateNotificationDto,
  GetNotificationsQueryDto,
} from '@packages/entities/notification';

@Injectable()
export class NotificationRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async create(data: CreateNotificationDto) {
    const [note] = await this.db
      .insert(notifications)
      .values({
        type: data.type,
        title: data.title,
        content: data.content,
        subContent: data.subContent ?? undefined,
        userId: data.userId ?? undefined,
        senderId: data.senderId ?? undefined,
        classId: data.classId ?? undefined,
        studentId: data.studentId ?? undefined,
        redirectUrl: data.redirectUrl ?? undefined,
        actionLabel: data.actionLabel ?? undefined,
        actionType: data.actionType ?? undefined,
        metadata: data.metadata ?? undefined,
      })
      .returning();
    return note;
  }

  /** Inserts one row per recipient so each user has their own read state. */
  async createMany(rows: CreateNotificationDto[]) {
    if (rows.length === 0) return [];
    return this.db
      .insert(notifications)
      .values(
        rows.map((data) => ({
          type: data.type,
          title: data.title,
          content: data.content,
          subContent: data.subContent ?? undefined,
          userId: data.userId ?? undefined,
          senderId: data.senderId ?? undefined,
          classId: data.classId ?? undefined,
          studentId: data.studentId ?? undefined,
          redirectUrl: data.redirectUrl ?? undefined,
          actionLabel: data.actionLabel ?? undefined,
          actionType: data.actionType ?? undefined,
          metadata: data.metadata ?? undefined,
        })),
      )
      .returning();
  }

  /** True when the class exists and is taught by `tutorId`. */
  async tutorOwnsClass(classId: string, tutorId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.tutorId, tutorId)))
      .limit(1);
    return rows.length > 0;
  }

  /** True when `studentId` is enrolled in at least one class taught by `tutorId`. */
  async tutorTeachesStudent(studentId: string, tutorId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: classStudents.id })
      .from(classStudents)
      .innerJoin(classes, eq(classes.id, classStudents.classId))
      .where(and(eq(classStudents.studentId, studentId), eq(classes.tutorId, tutorId)))
      .limit(1);
    return rows.length > 0;
  }

  async studentIdsOfClass(classId: string): Promise<string[]> {
    const rows = await this.db
      .select({ studentId: classStudents.studentId })
      .from(classStudents)
      .where(eq(classStudents.classId, classId));
    return rows.map((r) => r.studentId);
  }

  async findAll(userId: string, query: GetNotificationsQueryDto) {
    const { page, limit, search, type, isRead } = query;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [this.visibleTo(userId)];

    if (search) {
      conditions.push(ilike(notifications.title, `%${escapeLike(search)}%`));
    }
    if (type) conditions.push(eq(notifications.type, type));
    if (isRead !== undefined) conditions.push(eq(notifications.isRead, isRead));

    const where = and(...conditions);

    const [[totalRow], rows] = await Promise.all([
      this.db.select({ total: count() }).from(notifications).where(where),
      this.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset),
    ]);
    const total = Number(totalRow?.total ?? 0);

    return {
      data: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** `userId` set => rows the user received, plus unaddressed rows they sent; omitted (ADMIN) => unrestricted. */
  async findById(id: string, userId?: string) {
    const where = userId
      ? and(eq(notifications.id, id), this.visibleTo(userId))
      : eq(notifications.id, id);
    const [note] = await this.db.select().from(notifications).where(where);
    return note ?? null;
  }

  /**
   * `userId` set => recipient-only; omitted (ADMIN) => unrestricted.
   * Intentional: a sender can see a notification they sent but cannot mark it read or delete it,
   * since only the recipient manages its read/delete state.
   */
  async markAsRead(id: string, userId?: string) {
    const [note] = await this.db
      .update(notifications)
      // coalesce: re-reading an already-read notification keeps the first read time.
      .set({ isRead: true, readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(this.ownedBy(id, userId))
      .returning();
    return note ?? null;
  }

  /**
   * Marks the caller's own unread notifications (recipient only). Rows the caller *sent* are not
   * touched: their read state belongs to the recipient. Already-read rows are skipped so `readAt`
   * is never overwritten.
   */
  async markAllAsRead(userId: string) {
    const updated = await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
      .returning({ id: notifications.id });
    return { markedAll: true, count: updated.length };
  }

  /**
   * `userId` set => recipient-only; omitted (ADMIN) => unrestricted.
   * Intentional: the sender cannot delete a notification addressed to someone else (see markAsRead).
   */
  async delete(id: string, userId?: string) {
    const [note] = await this.db.delete(notifications).where(this.ownedBy(id, userId)).returning();
    return !!note;
  }

  /**
   * Received rows, plus rows the caller sent that have no recipient. Rows addressed to someone else
   * are owned by that recipient (a broadcast is stored once per recipient), so they are not listed
   * again under the sender.
   */
  private visibleTo(userId: string) {
    return or(
      eq(notifications.userId, userId),
      and(eq(notifications.senderId, userId), isNull(notifications.userId)),
    )!;
  }

  private ownedBy(id: string, userId?: string) {
    return userId
      ? and(eq(notifications.id, id), eq(notifications.userId, userId))
      : eq(notifications.id, id);
  }
}
