import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { notifications } from '../../database/schema';
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

  async findAll(userId: string, query: GetNotificationsQueryDto) {
    const { page, limit, search, type, isRead } = query;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [
      or(eq(notifications.userId, userId), eq(notifications.senderId, userId))!,
    ];

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

  /** `userId` set => only rows the user received or sent; omitted (ADMIN) => unrestricted. */
  async findById(id: string, userId?: string) {
    const where = userId
      ? and(
          eq(notifications.id, id),
          or(eq(notifications.userId, userId), eq(notifications.senderId, userId)),
        )
      : eq(notifications.id, id);
    const [note] = await this.db.select().from(notifications).where(where);
    return note ?? null;
  }

  /** `userId` set => recipient-only; omitted (ADMIN) => unrestricted. */
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

  /** `userId` set => recipient-only; omitted (ADMIN) => unrestricted. */
  async delete(id: string, userId?: string) {
    const [note] = await this.db.delete(notifications).where(this.ownedBy(id, userId)).returning();
    return !!note;
  }

  private ownedBy(id: string, userId?: string) {
    return userId
      ? and(eq(notifications.id, id), eq(notifications.userId, userId))
      : eq(notifications.id, id);
  }
}
