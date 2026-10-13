import { BadRequestException, Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
<<<<<<< Updated upstream
import type {
  CreateNotificationDto,
  GetNotificationsQueryDto,
=======
import { z } from 'zod';
import {
  createNotificationSchema,
  getNotificationsQuerySchema,
>>>>>>> Stashed changes
} from '@packages/entities/notification';
import { NotificationService } from './notification.service';

const actorSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  role: z.string().optional(),
});
const getAllSchema = z.object({
  userId: z.string().min(1),
  query: getNotificationsQuerySchema.optional().default(() => getNotificationsQuerySchema.parse({})),
});
const createPayloadSchema = z.object({ role: z.string().optional() });

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

/**
 * Message-pattern mirror of `NotificationController` — reached only by the gateway's
 * `THIRD_SERVICE` `ClientProxy` over RabbitMQ. Payloads are re-validated here (RMQ bypasses the
 * gateway's pipes); business rules (ownership, role permissions) live in `NotificationService`.
 */
@Controller()
export class NotificationRpcController {
  constructor(private readonly notificationService: NotificationService) {}

  @MessagePattern('notification.create')
  create(@Payload() payload: unknown) {
    const dto = parse(createNotificationSchema, payload);
    const { role } = parse(createPayloadSchema, payload);
    return this.notificationService.createNotificationService(dto, role);
  }

  @MessagePattern('notification.getAll')
  getAll(@Payload() payload: unknown) {
    const { userId, query } = parse(getAllSchema, payload);
    return this.notificationService.findAll(userId, query);
  }

  @MessagePattern('notification.markAllAsRead')
  markAllAsRead(@Payload() payload: { userId: string }) {
    return this.notificationService.markAllAsRead(payload.userId);
  }

  @MessagePattern('notification.getById')
<<<<<<< Updated upstream
  getById(@Payload() payload: { id: string; userId?: string }) {
    return this.notificationService.findById(payload.id, payload.userId);
  }

  @MessagePattern('notification.markAsRead')
  markAsRead(@Payload() payload: { id: string; userId?: string }) {
    return this.notificationService.markAsRead(payload.id, payload.userId);
  }

  @MessagePattern('notification.delete')
  del(@Payload() payload: { id: string; userId?: string }) {
    return this.notificationService.delete(payload.id, payload.userId);
=======
  getById(@Payload() payload: unknown) {
    const { id, userId, role } = parse(actorSchema, payload);
    return this.notificationService.findById(id, { userId, role });
  }

  @MessagePattern('notification.markAsRead')
  markAsRead(@Payload() payload: unknown) {
    const { id, userId, role } = parse(actorSchema, payload);
    return this.notificationService.markAsRead(id, { userId, role });
  }

  @MessagePattern('notification.delete')
  del(@Payload() payload: unknown) {
    const { id, userId, role } = parse(actorSchema, payload);
    return this.notificationService.delete(id, { userId, role });
>>>>>>> Stashed changes
  }
}
