import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UploadService } from './upload.service';
import type { MulterFile, UploadResponse } from './upload.interface';

interface UploadRpcFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: { type: 'Buffer'; data: number[] };
}

/**
 * Message-pattern mirror of `UploadController` — reached only by the gateway's `THIRD_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified `UploadService` the HTTP controller
 * uses. `Buffer`s are not JSON-serializable, so the gateway sends files as
 * `{ buffer: { type: 'Buffer', data } }` (multer/RabbitMQ JSON) and the download handler reads the
 * S3 stream into a Buffer before returning it.
 */
@Controller()
export class UploadRpcController {
  constructor(private readonly uploadService: UploadService) {}

  @MessagePattern('upload.upload')
  async upload(@Payload() payload: { file: UploadRpcFile }): Promise<UploadResponse> {
    return this.uploadService.upload(this.reconstruct(payload.file));
  }

  @MessagePattern('upload.uploadMultiple')
  async uploadMultiple(@Payload() payload: { files: UploadRpcFile[] }): Promise<UploadResponse[]> {
    return this.uploadService.uploadMultiple(payload.files.map((file) => this.reconstruct(file)));
  }

  @MessagePattern('upload.download')
  async download(@Payload() payload: { key: string }) {
    const { stream, contentType, contentLength } = await this.uploadService.download(payload.key);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      content: Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
      ),
      contentType,
      contentLength,
      filename: payload.key.split('/').pop() ?? 'download',
    };
  }

  @MessagePattern('upload.delete')
  async del(@Payload() payload: { key: string }) {
    return this.uploadService.delete(payload.key);
  }

  private reconstruct(file: UploadRpcFile): MulterFile {
    return {
      fieldname: file.fieldname,
      originalname: file.originalname,
      encoding: file.encoding,
      mimetype: file.mimetype,
      size: file.size,
      buffer: Buffer.from(file.buffer.data),
    };
  }
}