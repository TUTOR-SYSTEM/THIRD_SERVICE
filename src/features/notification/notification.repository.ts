import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { notifications } from '../../database/schema';
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
      conditions.push(ilike(notifications.title, `%${search}%`));
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

  /** Row is visible to its recipient or its sender; with no `userId` the check is skipped. */
  private scopeById(id: string, userId?: string): SQL {
    const byId = eq(notifications.id, id);
    if (!userId) return byId;
    return and(byId, or(eq(notifications.userId, userId), eq(notifications.senderId, userId)))!;
  }

  async findById(id: string, userId?: string) {
    const [note] = await this.db.select().from(notifications).where(this.scopeById(id, userId));
    return note ?? null;
  }

  async markAsRead(id: string, userId?: string) {
    const [note] = await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(this.scopeById(id, userId))
      .returning();
    return note ?? null;
  }

  async markAllAsRead(userId: string) {
    const updated = await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(or(eq(notifications.userId, userId), eq(notifications.senderId, userId)))
      .returning({ id: notifications.id });
    return { markedAll: true, count: updated.length };
  }

  async delete(id: string, userId?: string) {
    const [note] = await this.db
      .delete(notifications)
      .where(this.scopeById(id, userId))
      .returning();
    return !!note;
  }
}
