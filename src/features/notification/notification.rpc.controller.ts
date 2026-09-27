import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { CreateNotificationDto, GetNotificationsQueryDto } from '@packages/entities/notification';
import { NotificationService } from './notification.service';

/**
 * Message-pattern mirror of `NotificationController` — reached only by the gateway's
 * `THIRD_SERVICE` `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `NotificationService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class NotificationRpcController {
  constructor(private readonly notificationService: NotificationService) {}

  @MessagePattern('notification.create')
  create(@Payload() dto: CreateNotificationDto & { senderId: string }) {
    return this.notificationService.createNotificationService(dto);
  }

  @MessagePattern('notification.getAll')
  getAll(@Payload() payload: { userId: string; query: GetNotificationsQueryDto }) {
    return this.notificationService.findAll(payload.userId, payload.query);
  }

  @MessagePattern('notification.markAllAsRead')
  markAllAsRead(@Payload() payload: { userId: string }) {
    return this.notificationService.markAllAsRead(payload.userId);
  }

  @MessagePattern('notification.getById')
  getById(@Payload() payload: { id: string }) {
    return this.notificationService.findById(payload.id);
  }

  @MessagePattern('notification.markAsRead')
  markAsRead(@Payload() payload: { id: string }) {
    return this.notificationService.markAsRead(payload.id);
  }

  @MessagePattern('notification.delete')
  del(@Payload() payload: { id: string }) {
    return this.notificationService.delete(payload.id);
  }
}