import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { S3_CLIENT } from './upload.constant';
import type { MulterFile, UploadResponse } from './upload.interface';

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT)
    private readonly s3: S3Client | null,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.get<string>('CLOUDFLARE_R2_BUCKET', 'tutor');
  }

  async onModuleInit() {
    if (!this.s3) {
      this.logger.warn('Cloudflare R2 not configured — set CLOUDFLARE_R2_* env vars');
      return;
    }
    try {
      const key = `healthcheck-${Date.now()}.tmp`;
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: 'ok' }));
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.log(`Cloudflare R2 connected — bucket "${this.bucket}" ready`);
    } catch (_err) {
      const err = _err as Error & { name: string; $metadata?: { httpStatusCode?: number } };

      if (err.$metadata?.httpStatusCode === 403) {
        this.logger.error(
          `Cloudflare R2: Access Denied for bucket "${this.bucket}" — ` +
            'ensure the bucket exists in the R2 dashboard and the API token has write permission',
        );
      } else {
        this.logger.error(
          `Cloudflare R2 connection failed: ${err.name} — ${err.message}` +
            (err.$metadata ? ` [status=${err.$metadata.httpStatusCode}]` : ''),
        );
      }
    }
  }

  async upload(file: MulterFile, folder = 'uploads'): Promise<UploadResponse> {
    if (!this.s3) throw new Error('Cloudflare R2 not configured');
    const isImage = file.mimetype.startsWith('image/');
    const dot = file.originalname.lastIndexOf('.');
    const originalExt = dot >= 0 ? file.originalname.slice(dot + 1) : '';
    // Images are always re-encoded to JPEG below, so key/mimetype must say so.
    const ext = isImage ? 'jpg' : originalExt || 'bin';
    const key = `${folder}/${uuidv4()}.${ext}`;

    let processedBuffer = file.buffer;

    if (isImage) {
      processedBuffer = await sharp(file.buffer)
        .rotate()
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    }

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: processedBuffer,
        ContentType: isImage ? 'image/jpeg' : file.mimetype,
      }),
    );

    return {
      url: this.getPublicUrl(key),
      key,
      size: processedBuffer.length,
      mimetype: isImage ? 'image/jpeg' : file.mimetype,
    };
  }

  getPublicUrl(key: string): string {
    return `${this.configService.get<string>('CLOUDFLARE_R2_PUBLIC_URL')}/${key}`;
  }

  async download(
    key: string,
  ): Promise<{ stream: Readable; contentType: string; contentLength?: number }> {
    if (!this.s3) throw new Error('Cloudflare R2 not configured');
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      stream: result.Body as Readable,
      contentType: result.ContentType ?? 'application/octet-stream',
      contentLength: result.ContentLength,
    };
  }

  async delete(key: string): Promise<void> {
    if (!this.s3) throw new Error('Cloudflare R2 not configured');
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async uploadMultiple(files: MulterFile[], folder = 'uploads'): Promise<UploadResponse[]> {
    return Promise.all(files.map((f) => this.upload(f, folder)));
  }
}
