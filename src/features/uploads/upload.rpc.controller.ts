<<<<<<< Updated upstream
import { BadRequestException, Controller, NotFoundException } from '@nestjs/common';
=======
import { BadRequestException, Controller } from '@nestjs/common';
>>>>>>> Stashed changes
import { MessagePattern, Payload } from '@nestjs/microservices';
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
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified `UploadService` the HTTP controller
 * uses. `Buffer`s are not JSON-serializable, so the gateway sends files as
 * base64 strings (`buffer`) and the download handler reads the S3 stream into a
 * Buffer and returns it base64-encoded.
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
<<<<<<< Updated upstream
    return this.uploadService.uploadMultiple(
      (payload.files ?? []).map((file) => this.reconstruct(file)),
    );
=======
    if (!Array.isArray(payload.files) || payload.files.length > MAX_UPLOAD_FILES) {
      throw new BadRequestException(`At most ${MAX_UPLOAD_FILES} files are allowed`);
    }
    return this.uploadService.uploadMultiple(payload.files.map((file) => this.reconstruct(file)));
>>>>>>> Stashed changes
  }

  @MessagePattern('upload.download')
  async download(@Payload() payload: { key: string }) {
    const { stream, contentType, contentLength } = await this.uploadService
      .download(payload.key)
      .catch((err: { name?: string }) => {
        if (err.name === 'NoSuchKey' || err.name === 'NotFound') {
          throw new NotFoundException(`File "${payload.key}" not found`);
        }
        throw err;
      });
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buf.length;
      if (total > MAX_UPLOAD_BYTES) {
        stream.destroy();
        throw new BadRequestException('File too large to transfer over RPC');
      }
      chunks.push(buf);
    }
    return {
      buffer: Buffer.concat(chunks).toString('base64'),
      contentType,
      contentLength,
      filename: payload.key.split('/').pop() as string,
    };
  }

  @MessagePattern('upload.delete')
  async del(@Payload() payload: { key: string }) {
    return this.uploadService.delete(payload.key);
  }

  private reconstruct(file: UploadRpcFile): MulterFile {
<<<<<<< Updated upstream
    if (!file?.buffer?.data) throw new BadRequestException('file is required');
=======
    const buffer =
      typeof file.buffer === 'string'
        ? Buffer.from(file.buffer, 'base64')
        : Buffer.from(file.buffer.data);
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
    }
>>>>>>> Stashed changes
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
