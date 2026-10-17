import { BadRequestException, Controller, ForbiddenException } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ERROR_MESSAGES } from 'src/data/constants';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from './upload.constant';
import { UploadService } from './upload.service';
import type { MulterFile, UploadResponse } from './upload.interface';

interface UploadRpcFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  /** base64 string (gateway contract); legacy `{ type: 'Buffer', data }` is still accepted. */
  buffer: string | { type: 'Buffer'; data: number[] };
}

/**
 * Message-pattern mirror of `UploadController` — reached only by the gateway's `THIRD_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same `UploadService` the HTTP controller uses.
 * Every payload carries the caller's `userId` and `role` (forwarded by the gateway from the JWT).
 * Downloads are NOT streamed through the broker any more: `upload.download` replies with a
 * short-lived presigned URL (contract C5).
 */
@Controller()
export class UploadRpcController {
  constructor(private readonly uploadService: UploadService) {}

  @MessagePattern('upload.upload')
  async upload(
    @Payload() payload: { file: UploadRpcFile; userId: string; role: string },
  ): Promise<UploadResponse> {
    const actor = this.requireActor(payload);
    this.uploadService.assertUploaderRole(actor.role);
    await this.uploadService.consumeUploadQuota(actor.userId, 1);
    return this.uploadService.upload(this.reconstruct(payload.file), 'uploads', actor.userId);
  }

  @MessagePattern('upload.uploadMultiple')
  async uploadMultiple(
    @Payload() payload: { files: UploadRpcFile[]; userId: string; role: string },
  ): Promise<UploadResponse[]> {
    const actor = this.requireActor(payload);
    this.uploadService.assertUploaderRole(actor.role);
    if (!Array.isArray(payload.files) || payload.files.length > MAX_UPLOAD_FILES) {
      throw new BadRequestException(`At most ${MAX_UPLOAD_FILES} files are allowed`);
    }
    await this.uploadService.consumeUploadQuota(actor.userId, payload.files.length);
    return this.uploadService.uploadMultiple(
      payload.files.map((file) => this.reconstruct(file)),
      'uploads',
      actor.userId,
    );
  }

  /**
   * Owner (or ADMIN) only. Replies `{ url, expiresIn, contentType, filename }` with a presigned
   * GET URL valid for `PRESIGNED_DOWNLOAD_TTL_SECONDS`; the bytes never cross the broker.
   */
  @MessagePattern('upload.download')
  async download(@Payload() payload: { key: string; userId: string; role: string }) {
    const actor = this.requireActor(payload);
    return this.uploadService.presignDownload(payload.key, actor);
  }

  /**
   * ADMIN only (mirrors the HTTP `DELETE /upload/:key` RolesGuard). The gateway forwards the
   * caller's `role`; a missing or non-ADMIN role is rejected (fail closed). Replies `{ ok, key }`
   * so the caller never sees an empty reply after a successful delete.
   */
  @MessagePattern('upload.delete')
  async del(@Payload() payload: { key: string; role?: string }) {
    if (payload?.role !== 'ADMIN') {
      throw new ForbiddenException(ERROR_MESSAGES.ADMIN_ROLE_REQUIRED);
    }
    await this.uploadService.delete(payload.key);
    return { ok: true, key: payload.key };
  }

  private requireActor(payload: { userId?: unknown; role?: unknown }): {
    userId: string;
    role: string;
  } {
    if (typeof payload?.userId !== 'string' || payload.userId.length === 0) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
    return {
      userId: payload.userId,
      role: typeof payload.role === 'string' ? payload.role : '',
    };
  }

  private reconstruct(file: UploadRpcFile): MulterFile {
    if (!file?.buffer) throw new BadRequestException('file is required');
    const buffer =
      typeof file.buffer === 'string'
        ? Buffer.from(file.buffer, 'base64')
        : Buffer.from(file.buffer.data);
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
    }
    return {
      fieldname: file.fieldname ?? 'file',
      originalname: file.originalname,
      encoding: file.encoding ?? '7bit',
      mimetype: file.mimetype,
      size: buffer.length,
      buffer,
    };
  }
}
